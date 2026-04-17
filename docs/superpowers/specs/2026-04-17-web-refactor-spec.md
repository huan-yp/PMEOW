# Web 模块重构设计规格

> 日期: 2026-04-17
> 范围: packages/core/ + packages/web/ + packages/ui/（不含 Mobile App）
> 前置依赖: [Agent 重构设计规格](./2026-04-17-agent-refactor-spec.md)

## 1. 概述

配合 Agent 重构，对 Web 端进行全面重构。核心变更：

- **删除 SSH 数据源**：仅保留 Agent 推送模式，移除所有 SSH 采集、连接测试、密钥管理。
- **接收统一报告**：适配 Agent 新协议 `agent:report`，替代多个独立事件。
- **Web 侧任务事件派发**：Agent 不再维护事件系统，Web 通过 diff 活跃任务快照派发所有业务事件。
- **快照窗口存储**：短期窗口（30min，30 份）+ 永久归档窗口（每 30min 一份），GPU 独立行存储。
- **简化告警系统**：移除 hooks 引擎，保留阈值告警 + 去重 + 忽略管理。
- **领域模块化**：按领域（node / ingest / task / person / alert / security / auth）组织代码。
- **任务永久保留**：Web 负责持久化所有任务记录，不做定期清理。
- **人员归因实时计算**：去除独立归因表，通过快照中的 user 字段 + person_bindings 实时计算。

## 2. 架构

```
┌───────────────────────────────────────────────────────┐
│                    Web Server                         │
│                                                       │
│  ┌─────────┐  ┌─────────┐  ┌──────────┐  ┌────────┐  │
│  │  node   │  │  ingest │  │   task   │  │ person │  │
│  │(会话管理)│→│(报告处理)│→│(事件派发)│  │(归因)  │  │
│  └─────────┘  └─────────┘  └──────────┘  └────────┘  │
│  ┌─────────┐  ┌─────────┐  ┌──────────┐              │
│  │  alert  │  │security │  │   auth   │              │
│  │(告警)   │  │(安全事件)│  │(认证鉴权)│              │
│  └─────────┘  └─────────┘  └──────────┘              │
│                     ↕                                 │
│  ┌─────────────────────────────────────────────────┐  │
│  │                  SQLite                         │  │
│  │  snapshots / gpu_snapshots / tasks / alerts     │  │
│  │  security_events / persons / person_bindings    │  │
│  │  servers / settings                             │  │
│  └─────────────────────────────────────────────────┘  │
│                     ↕                                 │
│  ┌─────────────────────────────────────────────────┐  │
│  │           Socket.IO (UI namespace /)            │  │
│  │  推送: metricsUpdate / taskEvent / alert / ...  │  │
│  └─────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────┘
```

### 组件职责

| 模块 | 职责 |
|------|------|
| **node** | Agent Socket.IO 会话管理：连接/断连/注册，维护活跃会话注册表，转发命令到 Agent |
| **ingest** | 接收 `agent:report`，解析 UnifiedReport，更新内存缓存，驱动快照存储/告警检查/安全检查/任务 diff |
| **task** | 任务 diff 逻辑，事件派发（submitted/started/ended/priority_changed），任务 CRUD，命令下发 |
| **person** | 人员管理，账号绑定，基于快照的实时归因计算，VRAM 时间线查询 |
| **alert** | 阈值告警检测，同机器同类型去重，忽略管理，历史查询 |
| **security** | 安全事件检测（可疑进程、未归属 GPU），标记安全/重新打开 |
| **auth** | JWT 认证，密码管理 |

### 去除的组件

| 组件 | 原因 |
|------|------|
| SSH 数据源（ssh/、datasource/） | 统一为 Agent 推送 |
| Hooks 引擎（hooks/） | 简化告警，移除自定义规则 |
| GPU 归因独立表 | 改为基于快照实时计算 |
| 独立心跳检测 | 1s 周期的 report 本身就是心跳 |
| 任务按需拉取（getTaskQueue 等）| 任务随报告推送 |
| 队列暂停/恢复 | 移除 |

## 3. 数据存储

### 3.1 SQLite Schema

#### servers — 节点注册

```sql
CREATE TABLE servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    agent_id TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
```

去除的字段：`host`, `port`, `username`, `privateKeyPath`, `sourceType`（SSH 相关）。

#### snapshots — 资源快照（非 GPU 部分）

```sql
CREATE TABLE snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,          -- Unix 秒
    tier TEXT NOT NULL,                   -- 'recent' | 'archive'
    seq INTEGER,                         -- Agent 报告序号
    cpu TEXT NOT NULL,                    -- JSON: {usage, cores, frequency}
    memory TEXT NOT NULL,                 -- JSON: {totalMb, usedMb, percent}
    disks TEXT NOT NULL,                  -- JSON: [{mountpoint, totalMb, usedMb}]
    network TEXT NOT NULL,               -- JSON: [{interface, rxBytesPerSec, txBytesPerSec}]
    processes TEXT NOT NULL,             -- JSON: [已过滤的进程列表]
    internet TEXT NOT NULL,              -- JSON: {reachable, targets}
    local_users TEXT NOT NULL            -- JSON: [string]
);
CREATE INDEX idx_snapshots_query ON snapshots (server_id, tier, timestamp);
```

#### gpu_snapshots — GPU 快照（每张卡一行）

```sql
CREATE TABLE gpu_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
    server_id TEXT NOT NULL,
    gpu_index INTEGER NOT NULL,
    name TEXT NOT NULL,
    temperature INTEGER NOT NULL,
    utilization_gpu INTEGER NOT NULL,     -- compute 利用率 %
    utilization_memory INTEGER NOT NULL,  -- 显存利用率 %
    memory_total_mb INTEGER NOT NULL,
    memory_used_mb INTEGER NOT NULL,
    managed_reserved_mb INTEGER NOT NULL,
    unmanaged_peak_mb INTEGER NOT NULL,
    effective_free_mb INTEGER NOT NULL,
    task_allocations TEXT NOT NULL,       -- JSON: [{taskId, declaredVramMb}]
    user_processes TEXT NOT NULL,         -- JSON: [{pid, user, vramMb}]
    unknown_processes TEXT NOT NULL       -- JSON: [{pid, vramMb}]
);
CREATE INDEX idx_gpu_snapshots_query ON gpu_snapshots (server_id, gpu_index, snapshot_id);
```

#### tasks — 任务持久化

```sql
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL,
    status TEXT NOT NULL,                -- 'queued' | 'running' | 'ended'
    command TEXT NOT NULL,
    cwd TEXT NOT NULL,
    user TEXT NOT NULL,
    launch_mode TEXT NOT NULL,           -- 'daemon_shell' | 'attached_python'
    require_vram_mb INTEGER NOT NULL,
    require_gpu_count INTEGER NOT NULL,
    gpu_ids TEXT,                         -- JSON: [int] | null
    priority INTEGER NOT NULL DEFAULT 10,
    created_at REAL NOT NULL,
    started_at REAL,
    finished_at REAL,
    pid INTEGER,
    exit_code INTEGER,
    assigned_gpus TEXT,                   -- JSON: [int] | null
    declared_vram_per_gpu INTEGER,
    schedule_history TEXT                 -- JSON: 最后 5 条 ScheduleEvaluation
);
CREATE INDEX idx_tasks_server_status ON tasks (server_id, status);
CREATE INDEX idx_tasks_user ON tasks (user, created_at);
```

#### alerts — 告警（同机器同类型去重）

```sql
CREATE TABLE alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id TEXT NOT NULL,
    alert_type TEXT NOT NULL,            -- 'cpu' | 'memory' | 'disk' | 'gpu_temp' | 'offline'
    value REAL,
    threshold REAL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    suppressed_until INTEGER,            -- null = 未忽略
    UNIQUE (server_id, alert_type)
);
```

#### security_events — 安全事件

保留现有结构：

```sql
CREATE TABLE security_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id TEXT NOT NULL,
    event_type TEXT NOT NULL,            -- 'suspicious_process' | 'unowned_gpu' | 'high_gpu_utilization' | 'marked_safe' | 'unresolve'
    fingerprint TEXT NOT NULL,
    details TEXT NOT NULL,               -- JSON
    resolved INTEGER NOT NULL DEFAULT 0,
    resolved_by TEXT,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
);
CREATE UNIQUE INDEX idx_security_active ON security_events (server_id, event_type, fingerprint) WHERE resolved = 0;
```

#### persons — 人员

```sql
CREATE TABLE persons (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    email TEXT,
    qq TEXT,
    note TEXT,
    custom_fields TEXT,                  -- JSON
    status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'archived'
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
```

#### person_bindings — 人员绑定

```sql
CREATE TABLE person_bindings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id TEXT NOT NULL REFERENCES persons(id),
    server_id TEXT NOT NULL,
    system_user TEXT NOT NULL,
    source TEXT NOT NULL,                -- 'auto' | 'manual' | 'override'
    enabled INTEGER NOT NULL DEFAULT 1,
    effective_from INTEGER,
    effective_to INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (server_id, system_user) -- 同节点同系统用户只绑一个人
);
```

#### settings — 系统设置

```sql
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

存储内容：管理员密码哈希、告警阈值配置等。

### 3.2 去除的表

| 表 | 原因 |
|----|------|
| `metrics` | 替换为 `snapshots` + `gpu_snapshots` |
| `gpu_usage_stats` | GPU 归因信息合并到 `gpu_snapshots` 的 JSON 字段 |
| `agent_tasks` | 替换为 `tasks`（重新设计字段） |
| `hooks` / `hook_logs` | 移除 hooks 系统 |
| `alert_history` | 替换为 `alerts`（同类型去重） |
| `person_attribution_facts` | 改为基于快照实时计算 |
| `person_mobile_tokens` | 本轮不处理 Mobile |
| `person_mobile_preferences` | 本轮不处理 Mobile |
| `person_mobile_notifications` | 本轮不处理 Mobile |
| `server_local_users` | local_users 合并到快照 JSON |

### 3.3 窗口管理策略

**短期窗口（recent）：**
- 每 1 分钟从最新的 `agent:report` 中取一份写入 `snapshots` + `gpu_snapshots`，`tier='recent'`。
- 保留最近 30 份（覆盖约 30 分钟）。
- 写入时，删除同一 `server_id` 中超出 30 份的最旧 recent 记录（及关联的 gpu_snapshots，通过 CASCADE 自动删除）。

**永久窗口（archive）：**
- 每 30 分钟，将当前最新的 recent 快照复制一份，`tier='archive'`。
- 永久保留，不自动清理。
- 预期每台机器每天约 48 份 archive 快照。

**内存最新状态：**
- Agent 1s 推送的报告在内存中维护"当前最新"状态，用于：
  - 实时推送给前端 WebSocket
  - 告警阈值检查
  - 安全事件检查
- 不逐条写入 SQLite。

**存储预算估算：**
- 每台机器每天：48 archive + 30 recent（滚动）≈ 78 份快照
- 每份快照（含 GPU 行）约 5-15 KB
- 每台机器每天快照存储约 0.5-1 MB，远低于 10 MB 配额
- 剩余配额用于任务记录和告警

## 4. 传输协议

### 4.1 Agent Namespace (`/agent`)

**Agent → Web（上行）：**

| Socket.IO 事件 | 载荷 | 说明 |
|---------------|------|------|
| `agent:register` | `{agentId: string, hostname: string, version: string}` | 连接/重连时注册 |
| `agent:report` | `UnifiedReport` | 1s 周期统一报告 |

**Web → Agent（下行）：**

| Socket.IO 事件 | 载荷 | 说明 |
|---------------|------|------|
| `server:cancelTask` | `{taskId: string}` | 取消任务 |
| `server:setPriority` | `{taskId: string, priority: number}` | 调整优先级 |
| `server:requestCollection` | `{}` | 主动触发一次采集 |

**去除的事件：**

| 事件 | 原因 |
|------|------|
| `agent:metrics` | 合并到 `agent:report` |
| `agent:taskChanged` | 任务状态随报告推送 |
| `agent:localUsers` | 合并到 `agent:report` |
| `agent:heartbeat` | report 本身就是心跳 |
| `server:getTaskQueue` | 任务随报告推送 |
| `server:getTaskEvents` | Web 自行 diff 派发 |
| `server:getTaskAuditDetail` | 调度历史随报告推送 |
| `server:pauseQueue` / `server:resumeQueue` | 移除 |

### 4.2 UI Namespace (`/`)

**Server → Client：**

| Socket.IO 事件 | 载荷 | 说明 |
|---------------|------|------|
| `metricsUpdate` | `{serverId, snapshot}` | 节点最新资源快照 |
| `serverStatus` | `{serverId, status, lastSeenAt, version}` | 节点在线状态变更 |
| `taskEvent` | `{serverId, eventType, task}` | 任务事件（submitted/started/ended/priority_changed） |
| `alert` | `{serverId, alertType, value, threshold}` | 告警触发 |
| `securityEvent` | `SecurityEventRecord` | 安全事件 |
| `serversChanged` | `{}` | 节点列表变更 |

**去除的事件：**

| 事件 | 原因 |
|------|------|
| `hookTriggered` | 移除 hooks |
| `taskChanged` | 替换为更精确的 `taskEvent` |
| `notify` | 本轮不处理 Mobile/桌面通知 |

### 4.3 UnifiedReport 载荷结构（Agent → Web）

```typescript
interface UnifiedReport {
    agentId: string;
    timestamp: number;
    seq: number;

    resourceSnapshot: {
        gpuCards: GpuCardReport[];
        cpu: { usage: number; cores: number; frequency: number };
        memory: { totalMb: number; usedMb: number; percent: number };
        disks: { mountpoint: string; totalMb: number; usedMb: number }[];
        network: { interface: string; rxBytesPerSec: number; txBytesPerSec: number }[];
        processes: ProcessInfo[];
        internet: { reachable: boolean; targets: string[] };
        localUsers: string[];
    };

    taskQueue: {
        queued: TaskInfo[];
        running: TaskInfo[];
    };
}

interface GpuCardReport {
    index: number;
    name: string;
    temperature: number;
    utilizationGpu: number;
    utilizationMemory: number;
    memoryTotalMb: number;
    memoryUsedMb: number;
    managedReservedMb: number;
    unmanagedPeakMb: number;
    effectiveFreeMb: number;
    taskAllocations: { taskId: string; declaredVramMb: number }[];
    userProcesses: { pid: number; user: string; vramMb: number }[];
    unknownProcesses: { pid: number; vramMb: number }[];
}

interface TaskInfo {
    id: string;
    status: 'queued' | 'running';
    command: string;
    cwd: string;
    user: string;
    launchMode: 'daemon_shell' | 'attached_python';
    requireVramMb: number;
    requireGpuCount: number;
    gpuIds: number[] | null;
    priority: number;
    createdAt: number;
    startedAt: number | null;
    pid: number | null;
    assignedGpus: number[] | null;
    declaredVramPerGpu: number | null;
    scheduleHistory: ScheduleEvaluation[];
}

interface ScheduleEvaluation {
    timestamp: number;
    result: 'scheduled' | 'blocked_by_priority' | 'insufficient_gpu' | 'sustained_window_not_met';
    gpuSnapshot: Record<string, number>;   // gpuIndex → effectiveFreeMb
    detail: string;
}
```

## 5. Ingest 处理流程

### 5.1 处理管线

每次收到 `agent:report` 事件，按以下顺序处理：

```
agent:report
  │
  ├─ 1. 解析 & 验证 UnifiedReport
  │
  ├─ 2. 更新内存最新状态缓存
  │     └─ 存储 {serverId → latestReport}
  │
  ├─ 3. 广播 metricsUpdate 到 UI WebSocket
  │
  ├─ 4. 任务 Diff（详见 §5.2）
  │     ├─ 新任务 → INSERT + 派发 task_submitted / task_started
  │     ├─ 状态变化 → UPDATE + 派发对应事件
  │     └─ 消失任务 → UPDATE ended + 派发 task_ended
  │
  ├─ 5. 告警检查（详见 §6）
  │     └─ 阈值超标 → UPSERT alerts + 广播 alert
  │
  ├─ 6. 安全事件检查
  │     └─ 可疑进程/未归属 GPU → UPSERT security_events + 广播
  │
  └─ 7. 快照存储（详见 §5.3）
        └─ 判断是否到写 recent / archive 的时间
```

### 5.2 任务 Diff 逻辑

Web 为每台 Agent 维护上一轮的活跃任务快照（`Map<taskId, TaskInfo>`）。

**Diff 规则：**

| 变化 | 条件 | DB 操作 | 派发事件 |
|------|------|--------|---------|
| 新任务（queued） | taskId 不存在于上轮快照 | INSERT (status='queued') | `task_submitted` |
| 新任务（running） | taskId 不存在于上轮快照，且 status=running | INSERT (status='running') | `task_submitted` + `task_started` |
| 状态升级 | 上轮 queued → 本轮 running | UPDATE status='running', started_at, pid, assigned_gpus | `task_started` |
| 优先级变更 | 同任务 priority 不同 | UPDATE priority | `task_priority_changed` |
| 调度历史更新 | 同任务 schedule_history 有变化 | UPDATE schedule_history | 无事件（前端按需拉取） |
| 任务消失 | taskId 存在于上轮但不存在于本轮 | UPDATE status='ended', finished_at=now（diff 发生时间） | `task_ended` |

**不变量：**
- 任务状态只能单向流转：`queued → running → ended`。
- 一旦标记为 `ended`，不会再恢复。
- 如果 Agent 重启后同一 taskId 重新出现（概率极低），视为新任务。
- `finished_at` 使用 Web 端 diff 发生的时间（非 Agent 上报时间）。
- `exit_code` 在当前协议中始终为 null（Agent 不上报终态信息），字段保留以备协议扩展。

### 5.3 快照存储调度

Web 在内存中为每台 Agent 维护两个时间戳：

```typescript
interface SnapshotScheduler {
    lastRecentAt: number;    // 上次写 recent 的时间
    lastArchiveAt: number;   // 上次写 archive 的时间
}
```

**判定逻辑（每次收到 report 时执行）：**

```
if (now - lastRecentAt >= 60s):
    写入 snapshots + gpu_snapshots (tier='recent')
    删除该 server 超出 30 份的最旧 recent 快照
    lastRecentAt = now

if (now - lastArchiveAt >= 1800s):
    写入 snapshots + gpu_snapshots (tier='archive')
    lastArchiveAt = now
```

## 6. 告警系统

### 6.1 告警类型与阈值

| 告警类型 | 检测源 | 默认阈值 | 说明 |
|---------|-------|---------|------|
| `cpu` | resourceSnapshot.cpu.usage | 90% | CPU 使用率持续高 |
| `memory` | resourceSnapshot.memory.percent | 90% | 内存使用率高 |
| `disk` | resourceSnapshot.disks[].usedPercent | 90% | 磁盘使用率高 |
| `gpu_temp` | gpuCards[].temperature | 85°C | GPU 温度过高 |
| `offline` | 心跳超时 | 30s 无报告 | 节点离线 |

阈值可通过 settings 表配置。

### 6.2 去重与更新

同一 `(server_id, alert_type)` 只维护一条记录（UNIQUE 约束）：

- **首次触发**：INSERT，广播 `alert` 事件。
- **再次触发**：UPDATE `value` + `updated_at`，不重复广播（除非已被忽略后重新触发）。
- **恢复正常**：不主动删除记录，前端通过 `updated_at` 判断时效性。

### 6.3 忽略管理

- `POST /api/alerts/:id/suppress`：设置 `suppressed_until` 时间戳，在此之前不再广播。
- `POST /api/alerts/:id/unsuppress`：清除 `suppressed_until`。
- 被忽略的告警在检测到阈值超标时仍然更新 `value` 和 `updated_at`，但不广播到前端。

### 6.4 节点离线检测

- Web 为每台在线 Agent 维护 `lastReportAt` 时间戳。
- 独立定时器每 10s 扫描一次：如果 `now - lastReportAt > 30s`，触发 `offline` 告警。
- Agent 重新上报后自动恢复（更新 `lastReportAt`，offline 告警自然过时）。

## 7. 安全事件

保持现有安全事件检测逻辑，适配新的数据源：

- **可疑进程**：基于进程列表中 GPU 占用 > 0 但不属于任何已知任务的进程。
- **未归属 GPU 使用**：基于 `gpu_snapshots.unknown_processes`。
- 检测在 ingest 处理管线中执行（每次收到 report 时）。

## 8. REST API

### 8.1 认证

```
POST /api/login
  Body: { password: string }
  Response: { token: string }
```

### 8.2 节点管理

```
GET  /api/servers
  Response: Server[]

POST /api/servers
  Body: { name: string, agentId: string }
  Response: Server

DELETE /api/servers/:id
  Response: 204

GET  /api/statuses
  Response: { [serverId]: { status: 'online'|'offline', lastSeenAt: number, version: string } }
```

### 8.3 快照查询

```
GET  /api/metrics/latest
  Response: { [serverId]: { snapshot, gpuCards[] } }

GET  /api/metrics/:serverId/history
  Query: { from?: number, to?: number, tier?: 'recent'|'archive' }
  Response: { snapshots: SnapshotWithGpu[] }
```

### 8.4 任务管理

```
GET  /api/tasks
  Query: { serverId?: string, status?: string, user?: string, page?: number, limit?: number }
  Response: { tasks: Task[], total: number }

GET  /api/tasks/:taskId
  Response: Task

POST /api/servers/:serverId/tasks/:taskId/cancel
  Response: 200 | 404

POST /api/servers/:serverId/tasks/:taskId/priority
  Body: { priority: number }
  Response: 200 | 404
```

### 8.5 GPU 概览

```
GET  /api/gpu-overview
  Response: { servers: { serverId, serverName, gpus: GpuCardReport[] }[] }
```

### 8.6 人员管理

```
GET  /api/persons
  Response: Person[]

POST /api/persons
  Body: { displayName, email?, qq?, note? }
  Response: Person

GET  /api/persons/:id
  Response: Person

PUT  /api/persons/:id
  Body: { displayName?, email?, qq?, note?, status? }
  Response: Person

GET  /api/persons/:id/bindings
  Response: PersonBinding[]

POST /api/person-bindings
  Body: { personId, serverId, systemUser, source? }
  Response: PersonBinding

PUT  /api/person-bindings/:id
  Body: { enabled?, effectiveFrom?, effectiveTo? }
  Response: PersonBinding

GET  /api/persons/:id/timeline
  Query: { from?: number, to?: number }
  Response: { points: { timestamp, vramMb, serverId, gpuIndex }[] }
  说明: 从 gpu_snapshots.user_processes 中按 person_bindings 匹配 user 字段，聚合 VRAM

GET  /api/persons/:id/tasks
  Query: { page?, limit? }
  Response: { tasks: Task[], total: number }
  说明: 从 tasks 表中按 user + person_bindings 匹配

GET  /api/person-binding-candidates
  Response: { candidates: { serverId, systemUser }[] }
  说明: 从最新快照的 local_users 中提取未绑定的用户
```

### 8.7 告警管理

```
GET  /api/alerts
  Query: { serverId?: string }
  Response: Alert[]

POST /api/alerts/:id/suppress
  Body: { until: number }   -- Unix timestamp
  Response: 200

POST /api/alerts/:id/unsuppress
  Response: 200
```

### 8.8 安全事件

```
GET  /api/security/events
  Query: { serverId?: string, resolved?: boolean }
  Response: SecurityEvent[]

POST /api/security/events/:id/mark-safe
  Response: 200

POST /api/security/events/:id/unresolve
  Response: 200
```

### 8.9 设置

```
GET  /api/settings
  Response: Settings (密码哈希不返回)

PUT  /api/settings
  Body: Settings
  Response: 200
```

### 8.10 去除的 API

| API | 原因 |
|-----|------|
| `POST /api/servers/test` | SSH 已移除 |
| `POST /api/servers/:id/test` | SSH 已移除 |
| `POST /api/keys/upload` | SSH 已移除 |
| `/api/hooks/*` | Hooks 已移除 |
| `GET /api/servers/:id/tasks` | 合并到 `GET /api/tasks?serverId=` |
| `GET /api/servers/:id/tasks/:taskId/events` | Web 自行派发事件 |
| `GET /api/servers/:id/gpu-allocation` | 合并到快照 |
| `GET /api/servers/:id/gpu-allocation/resolved` | 合并到快照 |
| `POST /api/servers/:id/queue/pause` | 移除 |
| `POST /api/servers/:id/queue/resume` | 移除 |
| `GET /api/gpu-usage/*` | 改为基于快照查询 |
| `GET /api/servers/:id/process-audit` | 合并到快照/进程查询 |
| `GET /api/task-queue` | 合并到 `GET /api/tasks` |
| `GET /api/persons/summary` | 改为前端按需计算 |
| `GET /api/persons/:id/node-distribution` | 改为前端按需计算 |
| `GET /api/persons/:id/peak-periods` | 改为前端按需计算 |
| `GET /api/person-binding-suggestions` | 合并到 candidates |
| Mobile 相关 `/api/mobile/*` | 本轮不处理 |

## 9. 前端 UI

### 9.1 技术栈

保留现有：React + Zustand + ECharts + Tailwind CSS + React Router。

### 9.2 页面结构

```
├── Overview                    -- 集群概览（所有节点实时状态卡片）
├── Nodes                       -- 节点列表管理
│   └── NodeDetail              -- 单节点详情
│       ├── 实时概览 Tab         -- 折线图（GPU/CPU/内存） + GPU 横条
│       ├── 进程 Tab             -- 当前进程列表 / 历史快照进程查看
│       └── 历史 Tab             -- 时间选择器 + 历史快照回放
├── Tasks                       -- 跨节点任务列表（分页，筛选）
│   └── TaskDetail              -- 单任务详情 + 调度历史 + 资源占用折线
├── People                      -- 人员列表管理
│   └── PersonDetail            -- 人员详情 + VRAM 时间线 + 任务列表
├── Alerts                      -- 告警列表（分页，忽略管理）
├── Security                    -- 安全事件列表
└── Settings                    -- 系统设置（告警阈值配置）
```

### 9.3 可复用组件

#### `<TimeSeriesChart>` — 折线图基础组件

支持两种模式：

**实时模式：**
- 连接 WebSocket，接收 `metricsUpdate` 增量数据
- 前端维护数据缓存（最近 N 分钟）
- 每次收到新数据点追加到缓存尾部，移除过期点
- 提供手动刷新按钮（清除缓存，重新请求历史数据）

**历史模式：**
- 一次请求 `GET /api/metrics/:serverId/history` 获取快照数据
- 自适应数据点跨度：
  - 时间范围 ≤ 30min → 使用 `tier='recent'` 数据（~1min 粒度）
  - 时间范围 > 30min → 使用 `tier='archive'` 数据（~30min 粒度）
- 前端渲染 ECharts 折线图

**通用属性：**
- `dataKey`: 要绘制的字段路径（如 `cpu.usage`、`memory.percent`）
- `serverId`: 目标节点
- `timeRange`: 时间范围
- `mode`: `'realtime' | 'history'`

#### `<GpuBar>` — GPU 占用横条

展示单张 GPU 卡的当前显存分配情况：

```
┌──────────────────────────────────────────────────────┐
│ ██████ managed(A) ██████ managed(B) ░░ unmanaged ░░  │ free
│ 4096MB (TaskA)     2048MB (TaskB)    1024MB           │ 4832MB
└──────────────────────────────────────────────────────┘
  GPU 0: RTX 4090 (24GB)  Temperature: 72°C  Util: 85%
```

- managed 区域按任务/人员分组着色
- unmanaged 区域灰色
- free 区域空白
- 悬停显示详细进程列表（task_allocations + user_processes + unknown_processes）

#### `<SnapshotTimePicker>` — 快照时间选择器

用于历史回放功能：
- 时间轴滑块，标注有快照数据的时间点
- 选择时间点后加载对应快照，更新概览页面所有图表

### 9.4 前端数据流

**Zustand Store 设计：**

```typescript
interface AppStore {
    // 认证
    authenticated: boolean;
    login(password: string): Promise<void>;
    logout(): void;

    // 节点
    servers: Map<string, Server>;
    statuses: Map<string, ServerStatus>;

    // 实时数据（内存中，不持久化）
    latestSnapshots: Map<string, UnifiedReport>;

    // 任务
    tasks: Task[];
    taskTotal: number;

    // 告警
    alerts: Alert[];

    // 安全事件
    securityEvents: SecurityEvent[];

    // Toast 通知
    toasts: Toast[];
    addToast(toast: Toast): void;
}
```

**WebSocket 事件处理：**

| 收到事件 | Store 更新 | UI 响应 |
|---------|-----------|--------|
| `metricsUpdate` | 更新 `latestSnapshots[serverId]` | 实时折线图自动刷新 |
| `serverStatus` | 更新 `statuses[serverId]` | 节点状态指示器变化 |
| `taskEvent` | 根据 eventType 更新 `tasks` 列表 | 任务列表刷新 + toast |
| `alert` | 更新 `alerts` 列表 | 告警列表刷新 + toast |
| `securityEvent` | 更新 `securityEvents` 列表 | 安全事件列表刷新 + toast |
| `serversChanged` | 重新拉取 servers 列表 | 节点列表刷新 |

### 9.5 进程追溯

节点详情的"进程"Tab 支持：

1. **当前进程列表**：展示最新快照中的进程，支持按 CPU/GPU/内存排序。
2. **历史快照查看**：选择一个时间点，加载该时间点附近的快照中的进程列表。
3. **PID 追溯**：选择一个 PID，在 recent/archive 快照中搜索包含该 PID 的所有记录，展示该进程的生命周期和资源占用变化（复用 `<TimeSeriesChart>`）。

### 9.6 去除的页面/功能

| 页面/功能 | 原因 |
|----------|------|
| Hooks 管理页 | 移除 hooks |
| SSH 连接测试 | 移除 SSH |
| 密钥上传 | 移除 SSH |
| 队列暂停/恢复按钮 | 移除 |
| Mobile Admin/Person 页面 | 本轮不处理 |

## 10. 代码组织

### 10.1 packages/core/src/ — 领域逻辑层

```
packages/core/src/
├── db/
│   ├── database.ts              -- [重写] SQLite 初始化，新 schema
│   ├── snapshots.ts             -- [新] snapshots + gpu_snapshots CRUD
│   ├── tasks.ts                 -- [重写] tasks 表 CRUD
│   ├── alerts.ts                -- [重写] alerts 表 CRUD（去重逻辑）
│   ├── security-events.ts       -- [改] 适配新数据源
│   ├── servers.ts               -- [改] 去掉 SSH 字段
│   ├── persons.ts               -- [保留] persons 表 CRUD
│   ├── person-bindings.ts       -- [改] 从 person-attribution.ts 拆出，去掉归因表
│   └── settings.ts              -- [保留]
│
├── node/
│   ├── registry.ts              -- [改] Agent 会话注册表（从 agent/registry.ts 迁移）
│   └── session.ts               -- [改] Agent 会话对象，封装命令下发
│
├── ingest/
│   ├── pipeline.ts              -- [新] 报告处理管线（解析 → diff → 存储 → 告警 → 安全）
│   ├── task-differ.ts           -- [新] 任务 diff 逻辑
│   └── snapshot-scheduler.ts    -- [新] 快照写入调度（recent/archive 窗口管理）
│
├── task/
│   ├── service.ts               -- [新] 任务查询、命令下发
│   └── events.ts                -- [新] 任务事件类型定义与派发
│
├── person/
│   ├── service.ts               -- [改] 人员查询，实时归因计算
│   └── resolve.ts               -- [保留] user → person 解析
│
├── alert/
│   └── service.ts               -- [新] 告警检测、去重、忽略管理
│
├── security/
│   ├── analyzer.ts              -- [改] 安全事件分析（适配新数据源）
│   └── service.ts               -- [改] 安全事件 CRUD
│
├── auth/
│   └── auth.ts                  -- [保留] JWT + 密码验证
│
└── types.ts                     -- [重写] 所有 TypeScript 类型定义
```

### 10.2 packages/web/src/ — HTTP/WebSocket 路由层

```
packages/web/src/
├── server.ts                    -- [改] 入口，初始化
├── app.ts                       -- [改] Express 配置，Socket.IO 命名空间
├── agent-namespace.ts           -- [重写] /agent 命名空间，接收 agent:report
├── routes/
│   ├── server-routes.ts         -- [改] 节点管理 REST（去 SSH）
│   ├── metrics-routes.ts        -- [改] 快照查询 REST
│   ├── task-routes.ts           -- [改] 任务管理 REST
│   ├── person-routes.ts         -- [保留] 人员管理 REST
│   ├── alert-routes.ts          -- [新] 告警管理 REST
│   ├── security-routes.ts       -- [改] 安全事件 REST
│   └── settings-routes.ts       -- [改] 设置 REST
├── auth.ts                      -- [保留] 中间件
└── ui-broadcast.ts              -- [新] UI namespace 广播封装
```

### 10.3 packages/ui/src/ — 前端

```
packages/ui/src/
├── App.tsx                      -- [改] 路由配置（去掉 hooks 页面）
├── store/
│   └── useStore.ts              -- [重写] Zustand store
├── transport/
│   ├── ws-adapter.ts            -- [改] 适配新事件
│   └── TransportProvider.tsx    -- [改] 适配新事件
├── pages/
│   ├── Overview.tsx             -- [重写] 集群概览
│   ├── Nodes.tsx                -- [改] 节点列表
│   ├── NodeDetail.tsx           -- [重写] 节点详情（三 Tab）
│   ├── Tasks.tsx                -- [改] 任务列表
│   ├── TaskDetail.tsx           -- [改] 任务详情
│   ├── People.tsx               -- [改] 人员列表
│   ├── PersonDetail.tsx         -- [改] 人员详情
│   ├── Alerts.tsx               -- [重写] 告警列表
│   ├── Security.tsx             -- [保留]
│   ├── Settings.tsx             -- [改] 设置页面
│   └── Login.tsx                -- [保留]
├── components/
│   ├── TimeSeriesChart.tsx      -- [新] 折线图基础组件
│   ├── GpuBar.tsx               -- [新] GPU 占用横条
│   ├── SnapshotTimePicker.tsx   -- [新] 快照时间选择器
│   └── ...                      -- 其余复用组件
└── hooks/
    ├── useMetrics.ts            -- [改] 适配新事件
    └── useRealtimeData.ts       -- [新] 实时数据订阅 hook
```

### 10.4 删除的文件

| 文件/目录 | 原因 |
|----------|------|
| `core/src/ssh/` | 移除 SSH 数据源 |
| `core/src/datasource/` | 移除数据源抽象层 |
| `core/src/agent/binding.ts` | 合并到 node/registry |
| `core/src/agent/ingest.ts` | 替换为 ingest/pipeline |
| `core/src/agent/command-service.ts` | 合并到 node/session |
| `core/src/agent/gpu-allocation-resolver.ts` | GPU 分配合并到快照 |
| `core/src/hooks/` | 移除 hooks |
| `core/src/scheduler.ts` | 替换为 ingest/pipeline |
| `core/src/alerts.ts` | 替换为 alert/service |
| `core/src/person/attribution.ts` | 改为实时计算 |
| `core/src/db/metrics.ts` | 替换为 db/snapshots |
| `core/src/db/gpu-usage.ts` | 合并到 gpu_snapshots |
| `core/src/db/hooks.ts` | 移除 hooks |
| `core/src/db/person-attribution.ts` | 改为实时计算 |
| `core/src/db/person-mobile-*.ts` | 本轮不处理 Mobile |
| `core/src/db/agent-tasks.ts` | 替换为 db/tasks |
| `web/src/handlers.ts` | 拆分为 routes/ 下的各文件 |
| `web/src/agent-routes.ts` | 合并到 routes/ |
| `web/src/operator-routes.ts` | 合并到 routes/ |
| `web/src/person-routes.ts` | 移至 routes/ |
| `web/src/mobile-*.ts` | 本轮不处理 Mobile |
| `ui/src/pages/HooksManage.tsx` | 移除 hooks |
| `ui/src/pages/Mobile*.tsx` | 本轮不处理 |

## 11. 错误处理

| 场景 | 处理方式 |
|------|---------|
| **Agent 断连** | node/registry 标记为离线，30s 后触发 offline 告警 |
| **Agent 重启（任务全部消失）** | diff 将所有活跃任务标记为 ended |
| **Report 解析失败** | 记录日志，跳过本次处理，不影响后续 |
| **SQLite 写入失败** | 记录日志，内存状态仍然更新（降级为仅实时） |
| **快照存储延迟** | 自然滑动，不强制对齐 |
| **前端 WebSocket 断连** | 重连后自动拉取 latest + servers 恢复状态 |

## 12. 配置

| 配置项 | 默认值 | 说明 |
|-------|-------|------|
| `PORT` | `17200` | HTTP/WebSocket 端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `MONITOR_DB_PATH` | `./data/monitor.db` | SQLite 数据库路径 |
| `RECENT_SNAPSHOT_COUNT` | `30` | 短期窗口保留份数 |
| `RECENT_SNAPSHOT_INTERVAL` | `60` | 短期窗口写入间隔（秒） |
| `ARCHIVE_SNAPSHOT_INTERVAL` | `1800` | 永久窗口写入间隔（秒） |
| `OFFLINE_TIMEOUT` | `30` | 节点离线判定超时（秒） |
| `ALERT_CPU_THRESHOLD` | `90` | CPU 告警阈值 (%) |
| `ALERT_MEMORY_THRESHOLD` | `90` | 内存告警阈值 (%) |
| `ALERT_DISK_THRESHOLD` | `90` | 磁盘告警阈值 (%) |
| `ALERT_GPU_TEMP_THRESHOLD` | `85` | GPU 温度告警阈值 (°C) |

## 13. 测试策略

| 层级 | 范围 | 方式 |
|------|------|------|
| **单元测试** | 任务 diff 逻辑 | Mock 上下轮快照，验证事件派发和 DB 操作 |
| **单元测试** | 快照窗口调度 | 验证 recent/archive 写入时机和淘汰逻辑 |
| **单元测试** | 告警去重 | 验证同类型 UPSERT 行为 |
| **单元测试** | 人员归因计算 | Mock 快照 + bindings，验证 VRAM 聚合 |
| **集成测试** | Ingest 管线 | Mock agent:report，验证完整处理链 |
| **集成测试** | REST API | HTTP 请求 → DB 验证 |
| **集成测试** | WebSocket 广播 | 连接 UI namespace，验证收到事件 |
| **E2E 测试** | Agent 连接 → 报告 → 前端更新 | 模拟 Agent 发送报告，验证前端收到推送 |

## 14. 与 Agent 的接口约定

### Web 端需要适配的变更（对齐 Agent Spec）

1. **监听 `agent:report` 替代多个独立事件**：不再有 `agent:metrics`、`agent:taskChanged`、`agent:localUsers`、`agent:heartbeat`。
2. **Web 自行 diff 派发任务事件**：Agent 不维护事件队列，只报告当前活跃任务。Web 根据快照 diff 生成 `task_submitted`、`task_started`、`task_ended`、`task_priority_changed` 事件。
3. **心跳检测**：以是否收到 `agent:report` 为准（>30s 无报告视为离线）。
4. **任务持久化**：Web 负责将任务归档为 `ended`，Agent 不存储历史。
5. **去除按需拉取**：不再有 `server:getTaskQueue`、`server:getTaskEvents`、`server:getTaskAuditDetail`，数据随报告推送。
6. **新增 `server:requestCollection`**：主动触发采集。
7. **GPU 展示**：前端需要区分展示实际使用（managed_reserved）、未管理冗余（unmanaged_peak）、调度可用（effective_free）三部分。
8. **任务状态简化**：Agent 对外只暴露 `queued` 和 `running`；Web 归档为 `ended`。
