# 任务生命周期拉取模型重构规范

日期：2026-04-17

## 背景与问题

当前系统使用推送镜像模型管理任务状态：agent 每次任务状态变化时通过 `agent:taskUpdate` 事件推送完整任务快照，web 服务端将其写入本地 SQLite `agent_tasks` 表，UI 从该表查询展示。

该模型存在以下结构性问题：

1. **死任务**：web 端镜像与 agent 端真实状态不同步。agent 重启、网络断开、离线缓冲区溢出（上限 100 条）均可导致 web 端任务永久显示为 queued 或 running。
2. **双源不一致**：任务列表从 web 本地 SQLite 读取（`getAgentTaskQueueGroups()`），但审计详情和事件从 agent 实时拉取（`server:getTaskAuditDetail`），两者可能矛盾。
3. **Ctrl+C 可靠性**：当 attached_python 模式的 CLI 在排队阶段被 Ctrl+C 中断时，任务在 web 端永久显示为排队中。虽然上一轮修复了 CLI 侧发送 `cancel_task` 的问题，但根本原因是 web 端依赖推送而非查询 agent 真实状态。

## 目标

1. 确立 agent 为任务状态的唯一真相源（single source of truth）。
2. web 端不再持久化任务状态镜像，改为按需向 agent 拉取。
3. agent 推送仅作为变化通知信号（"有变化，请刷新"），不携带任务完整快照。
4. 保留 attached_python 模式。CLI 启动子进程后注册 PID，daemon 通过 psutil 持续监控进程存活。
5. CLI Ctrl+C 时直接 SIGTERM 子进程，然后通知 daemon exit_code=130（当前行为，不变）。

## 非目标

1. 不将浏览器到 web 的 REST facade 改为纯 WebSocket。
2. 不改变 agent 本地 daemon socket 对 CLI 提供的接口。
3. 不改变任务数据库 schema（agent 侧的 tasks、task_events、task_runtime 表不变）。
4. 不改变调度算法或 GPU 分配逻辑。
5. 不改变 metrics 推送模型（metrics 仍然由 agent 主动推送）。

## 架构概览

### 当前模型（推送镜像）

```
agent ──agent:taskUpdate(完整快照)──▸ web ──upsert──▸ SQLite agent_tasks
                                                          │
UI ◂── GET /api/task-queue ◂── getAgentTaskQueueGroups() ─┘
```

### 目标模型（拉取 + 变化通知）

```
agent ──agent:taskChanged({ serverId })──▸ web ──▸ 广播给 UI "有变化"
                                                      │
UI 收到通知 ──GET /api/task-queue──▸ web ──server:getTaskQueue──▸ agent
                                      ◂──────────────────────────┘
```

## 变更清单

### 第一层：Agent transport（Python）

#### 1.1 替换 `send_task_update` 为 `send_task_changed`

当前 `AgentTransportClient.send_task_update(update: TaskUpdate)` 序列化完整任务快照并发送 `agent:taskUpdate` 事件。

变更为：

```python
def send_task_changed(self) -> None:
    """通知 web 端任务状态有变化，web 端应重新拉取。"""
    self._send_event("agent:taskChanged", {})
```

- 不携带任何任务数据，仅作为变化信号。
- 所有当前调用 `send_task_update()` 的位置改为调用 `send_task_changed()`。
- 离线缓冲区不需要为 `taskChanged` 保留多条——同一断线期间多次变化只需最终重连后发一次。可在 `_flush_buffer_locked()` 中对 `agent:taskChanged` 去重。

涉及文件：
- `agent/pmeow/transport/client.py`
- `agent/pmeow/daemon/service.py`（所有调用 `self.transport.send_task_update(...)` 的位置）

#### 1.2 新增 `server:getTaskQueue` 命令处理

agent 需要响应 web 端的任务队列拉取请求。

```python
def get_task_queue(self) -> dict:
    """返回当前任务队列快照，供 web 端查询。"""
    with self._lock:
        queued = list_tasks_by_status(self.db, TaskStatus.queued)
        running = list_tasks_by_status(self.db, TaskStatus.running)
        recent = list_recent_terminal_tasks(self.db, limit=20)
        return {
            "queued": [self._serialize_task(t) for t in queued],
            "running": [self._serialize_task(t) for t in running],
            "recent": [self._serialize_task(t) for t in recent],
        }
```

注册命令：
```python
self.transport.on_command("server:getTaskQueue", lambda _data: self.get_task_queue())
```

涉及文件：
- `agent/pmeow/daemon/service.py`
- `agent/pmeow/store/tasks.py`（新增 `list_tasks_by_status` 和 `list_recent_terminal_tasks`）

#### 1.3 删除 `TaskUpdate` 数据类

`models.py` 中的 `TaskUpdate` dataclass 不再需要。所有引用点移除。

涉及文件：
- `agent/pmeow/models.py`
- `agent/pmeow/daemon/service.py`

### 第二层：Web 服务端（TypeScript）

#### 2.1 agent namespace 事件处理

将 `agent:taskUpdate` 处理替换为 `agent:taskChanged`：

```typescript
// 移除
socket.on(AGENT_EVENT.taskUpdate, (payload) => { ... });

// 新增
socket.on('agent:taskChanged', () => {
  const state = socket.data.agentState;
  if (!state || !isCurrentState(states, state)) return;
  onTaskChanged?.(state.serverId);
});
```

`onTaskChanged` 回调由 web 应用层提供，负责将变化通知广播给连接的 UI 客户端。

涉及文件：
- `packages/web/src/agent-namespace.ts`

#### 2.2 移除 agent_tasks 本地存储

删除以下内容：
- `agent_tasks` 表的创建与迁移
- `upsertAgentTask()` 函数
- `getAgentTask()` 函数
- `getAgentTasksByServerId()` 函数
- `getAgentTaskQueueGroups()` 函数（改为 agent RPC）
- `mergeAgentTask()`、`agentTaskEquals()` 等辅助函数
- `ingestAgentTaskUpdate()` 函数

涉及文件：
- `packages/core/src/db/agent-tasks.ts`（删除或大幅精简）
- `packages/core/src/agent/ingest.ts`（移除任务相关逻辑）

#### 2.3 REST 路由改为 agent RPC 透传

`GET /api/task-queue` 改为通过 live session 向各在线 agent 发送 `server:getTaskQueue` 命令，汇总结果：

```typescript
app.get('/api/task-queue', async (req, res) => {
  const groups: AgentTaskQueueGroup[] = [];
  for (const [serverId, ds] of scheduler.getAllAgentDataSources()) {
    if (!ds.hasLiveSession()) continue;
    try {
      const queue = await ds.getTaskQueue();
      groups.push({ serverId, serverName: getServerName(serverId), ...queue });
    } catch {
      // agent 离线或超时，跳过
    }
  }
  res.json(groups);
});
```

同样，`GET /api/servers/:id/tasks` 和 `GET /api/servers/:id/tasks/:taskId` 也改为 agent RPC。

涉及文件：
- `packages/web/src/operator-routes.ts`
- `packages/web/src/agent-routes.ts`
- `packages/core/src/datasource/agent-datasource.ts`（新增 `getTaskQueue()` 方法）

#### 2.4 广播变化通知给 UI

web 收到 agent 的 `agent:taskChanged` 后，向 operator namespace 广播：

```typescript
// operator namespace
io.of('/operator').emit('taskChanged', { serverId });
```

UI 收到后自行决定是否重新拉取。

涉及文件：
- `packages/web/src/agent-namespace.ts`（`onTaskChanged` 回调）
- `packages/web/src/operator-namespace.ts`（广播）

### 第三层：UI（React）

#### 3.1 任务列表页按需拉取

`TaskQueue.tsx` 当前从 zustand store 的 `taskQueueGroups` 读取数据。改为：

1. 组件挂载时调用 `transport.getTaskQueue()` 拉取。
2. 监听 `taskChanged` 事件，收到后重新拉取。
3. 不再使用 zustand store 缓存任务队列。

```typescript
function TaskQueue() {
  const transport = useTransport();
  const [groups, setGroups] = useState<AgentTaskQueueGroup[]>([]);

  const fetchQueue = useCallback(async () => {
    const result = await transport.getTaskQueue();
    setGroups(result);
  }, [transport]);

  useEffect(() => {
    fetchQueue();
    const unsub = transport.onTaskChanged(() => fetchQueue());
    return unsub;
  }, [fetchQueue, transport]);

  // ... 渲染逻辑不变
}
```

涉及文件：
- `packages/ui/src/pages/TaskQueue.tsx`
- `packages/ui/src/pages/ServerDetail.tsx`（任务相关部分）

#### 3.2 审计详情页拉取

`TaskAuditDetail.tsx` 当前已经通过 `transport.getTaskAuditDetail()` 拉取，不变。

#### 3.3 zustand store 清理

从 `useStore` 中移除 `taskQueueGroups` 和 `setTaskQueueGroups`。

涉及文件：
- `packages/ui/src/store/useStore.ts`

#### 3.4 ws-adapter 新增事件订阅

```typescript
class WebSocketAdapter {
  onTaskChanged(cb: (serverId: string) => void): () => void {
    this.socket.on('taskChanged', (data: { serverId: string }) => cb(data.serverId));
    return () => this.socket.off('taskChanged');
  }
}
```

涉及文件：
- `packages/ui/src/transport/ws-adapter.ts`

### 第四层：类型定义

#### 4.1 移除 `AgentTaskUpdatePayload`

不再需要任务快照推送载荷。`MirroredAgentTaskRecord` 仍可保留作为查询结果的类型（或重命名为 `AgentTaskRecord`）。

#### 4.2 新增 `AgentTaskQueueResponse`

```typescript
export interface AgentTaskQueueResponse {
  queued: MirroredAgentTaskRecord[];
  running: MirroredAgentTaskRecord[];
  recent: MirroredAgentTaskRecord[];
}
```

涉及文件：
- `packages/core/src/types.ts`

## 迁移策略

### 阶段一：agent 侧新增能力（向后兼容）

1. 新增 `server:getTaskQueue` 命令处理。
2. 新增 `send_task_changed()` 方法。
3. 保留 `send_task_update()` 不删除（双发）。

### 阶段二：web + UI 迁移

1. web 端新增 `agent:taskChanged` 处理和 operator 广播。
2. REST 路由 `GET /api/task-queue` 改为 agent RPC。
3. UI `TaskQueue` 改为按需拉取 + 监听变化通知。
4. 移除 zustand 中的 `taskQueueGroups`。

### 阶段三：清理

1. 删除 `agent:taskUpdate` 事件处理。
2. 删除 `agent_tasks` 表及相关函数。
3. 删除 `TaskUpdate` dataclass 和 `send_task_update()`。
4. 删除 `AgentTaskUpdatePayload` 类型。
5. 移除 `ingestAgentTaskUpdate()`。

## 离线 agent 的行为

当 agent 离线时：

- `GET /api/task-queue` 不会包含该 agent 的数据（与该 agent 相关的 group 不出现）。
- UI 展示该节点时应显示"离线"状态，不展示过时的任务列表。
- 审计详情页访问离线 agent 的任务时返回错误"节点离线"。

这是正确的行为：既然 agent 离线，web 不应该声称知道它的任务状态。

## 验收标准

1. web 端无 `agent_tasks` 表，无任务状态本地持久化。
2. 任务队列页展示的数据全部来自在线 agent 的实时响应。
3. agent 重启后，web 端任务列表自动恢复为 agent 真实状态。
4. agent 断线后，web 端不再展示该节点的过时任务。
5. Ctrl+C 取消排队任务后，刷新任务列表可见任务状态变为 cancelled。
6. 所有现有测试调整后通过。
