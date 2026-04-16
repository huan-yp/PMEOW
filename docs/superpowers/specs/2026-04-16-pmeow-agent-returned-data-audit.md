# pmeow-agent 回传数据全面审计

日期：2026-04-16

## 结论

这次审计的核心结论有 5 条：

1. pmeow-agent 真正主动回传到 PMEOW Web 服务端的只有 5 类 Socket.IO 事件：`agent:register`、`agent:metrics`、`agent:taskUpdate`、`agent:localUsers`、`agent:heartbeat`。
2. agent 不会主动把任务日志、完整任务事件流、完整任务记录、环境变量快照上传到服务端；这些数据要么只保存在本地，要么只能通过按需接口读取。
3. 服务端看到的 `serverId` 并不完全来自 agent 原始 payload。`agent:register` 根本没有 `serverId`；`agent:metrics`、`agent:taskUpdate`、`agent:localUsers` 会在 Web 侧根据 `agentId + hostname` 的绑定关系做规范化或覆盖。
4. agent 还会通过本地 daemon socket 向本机 CLI 返回任务、日志、事件和队列状态，但这些属于本地控制面，不属于“主动上报到中心服务端”。
5. 当前实现里存在几处值得审阅的边界和风险：进程命令行会原样采集，CLI 提交会把完整环境变量快照写入本地 SQLite，GPU 归因只按任务根 PID 精确匹配，`get_logs` 的 `tail` 参数当前未真正生效。

## 审计范围与方法

本次为静态代码审计，没有做抓包或端到端手工复现。审计范围覆盖：

- agent 侧传输层、daemon、collector、任务存储与事件存储
- Web 侧 agent namespace 接收逻辑
- core 层协议定义、落库逻辑与镜像任务模型
- 本地 daemon socket 暴露给 CLI 的 JSON-line 协议

本报告把“回传哪些数据”拆成 4 类：

1. 主动回传到中心服务端的数据
2. 服务端按需向 agent 拉取、agent 再返回的数据
3. agent 通过本地 daemon socket 回给本机调用方的数据
4. agent 本地保存但不会镜像到服务端的数据

## 一、主动回传到中心服务端的数据

### 1.1 事件总表

| 事件 | 发送时机 | 目的地 | 备注 |
| --- | --- | --- | --- |
| `agent:register` | 连接建立时；重连后再次注册 | Web `/agent` namespace | 只带 agent 身份，不带 `serverId` |
| `agent:metrics` | 每次采集周期结束后 | Web `/agent` namespace | 包含完整 `MetricsSnapshot` |
| `agent:taskUpdate` | 任务提交、启动、完成、失败、取消、attached 启动/结束时 | Web `/agent` namespace | 镜像任务状态，不包含日志和环境变量 |
| `agent:localUsers` | 本地用户列表发生变化时 | Web `/agent` namespace | 只在支持 `pwd` 的平台上有内容 |
| `agent:heartbeat` | 心跳线程周期触发 | Web `/agent` namespace | 断线时直接跳过，不做离线缓存 |

### 1.2 `agent:register`

payload 字段非常少，只用于会话建档和绑定：

| 字段 | 含义 |
| --- | --- |
| `agentId` | agent 唯一标识 |
| `hostname` | 节点 hostname |
| `version` | agent 版本号 |

补充说明：

- `agent:register` 不携带 `serverId`。
- Web 侧收到注册后，会调用绑定逻辑，用 `agentId + hostname` 找到或自动创建一个 `sourceType=agent` 的 server 记录。
- 如果之前已经存在绑定，服务端会恢复该绑定，而不是依赖 agent 自己声明 `serverId`。

### 1.3 `agent:metrics`

这是体量最大、最核心的主动上报。结构体是 `MetricsSnapshot`，字段如下。

#### 顶层字段

| 字段 | 含义 |
| --- | --- |
| `serverId` | agent 生成的节点标识；进入 Web 后可能被重写为已绑定 serverId |
| `timestamp` | 采集时间戳；agent 侧为秒，Web 侧规范化为毫秒 |
| `cpu` | CPU 指标 |
| `memory` | 内存与 swap 指标 |
| `disk` | 磁盘分区和 IO 速率 |
| `network` | 网络吞吐、网卡计数器和可选互联网探测结果 |
| `gpu` | 整机 GPU 聚合指标 |
| `processes` | 进程快照列表 |
| `docker` | Docker 容器列表 |
| `system` | 主机名、uptime、load、kernel 等系统信息 |
| `gpuAllocation` | 可选；当 GPU 可用且传入 task store 时才生成 |

#### `cpu`

| 字段 | 含义 |
| --- | --- |
| `usagePercent` | 总 CPU 使用率 |
| `coreCount` | 逻辑核心数 |
| `modelName` | CPU 型号 |
| `frequencyMhz` | 当前频率 |
| `perCoreUsage` | 每核使用率数组 |

#### `memory`

| 字段 | 含义 |
| --- | --- |
| `totalMB` | 物理内存总量 |
| `usedMB` | 已使用内存 |
| `availableMB` | 可用内存 |
| `usagePercent` | 内存使用率 |
| `swapTotalMB` | swap 总量 |
| `swapUsedMB` | swap 已用 |
| `swapPercent` | swap 使用率 |

#### `disk`

| 字段 | 含义 |
| --- | --- |
| `disks[]` | 分区列表 |
| `ioReadKBs` | 磁盘读速率 KB/s |
| `ioWriteKBs` | 磁盘写速率 KB/s |

`disks[]` 的子字段：

| 字段 | 含义 |
| --- | --- |
| `filesystem` | 设备名 |
| `mountPoint` | 挂载点 |
| `totalGB` | 总容量 |
| `usedGB` | 已用容量 |
| `availableGB` | 可用容量 |
| `usagePercent` | 使用率 |

补充说明：

- collector 会主动跳过一批虚拟文件系统、Docker 注入挂载点和文件级 bind mount。
- 相同底层设备会做去重，保留挂载路径更短的一项。

#### `network`

| 字段 | 含义 |
| --- | --- |
| `rxBytesPerSec` | 总下载速率 |
| `txBytesPerSec` | 总上传速率 |
| `interfaces[]` | 各网卡累计收发字节 |
| `internetReachable` | 可选；外网连通性结论 |
| `internetLatencyMs` | 可选；探测延迟 |
| `internetProbeTarget` | 可选；探测目标 |
| `internetProbeCheckedAt` | 可选；探测结果时间 |

`interfaces[]` 的子字段：

| 字段 | 含义 |
| --- | --- |
| `name` | 网卡名 |
| `rxBytes` | 累计接收字节 |
| `txBytes` | 累计发送字节 |

补充说明：

- 互联网探测结果来自独立的 TCP connect probe，不是每轮都重新探测，而是带缓存。
- 默认目标是 `1.1.1.1:443` 和 `8.8.8.8:443`，这意味着 agent 会主动对公网地址发起 TCP 连接探测，除非显式禁用。

#### `gpu`

| 字段 | 含义 |
| --- | --- |
| `available` | 是否检测到可用 GPU |
| `totalMemoryMB` | 所有 GPU 显存总量 |
| `usedMemoryMB` | 所有 GPU 已用显存 |
| `memoryUsagePercent` | 总显存使用率 |
| `utilizationPercent` | 平均 GPU 利用率 |
| `temperatureC` | 最高 GPU 温度 |
| `gpuCount` | GPU 数量 |

#### `processes[]`

| 字段 | 含义 |
| --- | --- |
| `pid` | 进程 PID |
| `user` | 进程用户名 |
| `cpuPercent` | CPU 使用率 |
| `memPercent` | 内存使用率 |
| `rss` | 进程 RSS |
| `command` | 进程命令行或进程名 |

补充说明：

- `command` 是原样拼接出来的命令行，可能包含敏感参数。
- 代码里 `rss` 实际来自 `psutil.memory_info().rss`，单位是字节；TypeScript 注释却写成了 KB，这里存在单位语义不一致。
- 进程快照当前不包含 `ppid`、`create_time`、`taskId` 等进程树归属字段。

#### `docker[]`

| 字段 | 含义 |
| --- | --- |
| `id` | 容器 ID |
| `name` | 容器名 |
| `image` | 镜像名 |
| `status` | Docker 文本状态 |
| `state` | 容器状态 |
| `ports` | 端口映射 |
| `createdAt` | 创建时间 |

补充说明：

- collector 使用的是 `docker ps -a`，不是只看运行中容器，因此停止态容器也会出现在上报里。

#### `system`

| 字段 | 含义 |
| --- | --- |
| `hostname` | 主机名 |
| `uptime` | 人类可读 uptime |
| `loadAvg1` | 1 分钟 load average |
| `loadAvg5` | 5 分钟 load average |
| `loadAvg15` | 15 分钟 load average |
| `kernelVersion` | 内核版本 |

#### `gpuAllocation`

只有在两件事同时满足时才会上报：

1. agent 检测到 GPU 可用
2. `collect_snapshot()` 调用时传入了 task store

`gpuAllocation` 分两部分：

##### `perGpu[]`

| 字段 | 含义 |
| --- | --- |
| `gpuIndex` | GPU 序号 |
| `totalMemoryMB` | 该卡总显存 |
| `usedMemoryMB` | 该卡实际已用显存 |
| `pmeowTasks[]` | 归因到 PMEOW 任务的显存占用 |
| `userProcesses[]` | 归因到普通用户进程的显存占用 |
| `unknownProcesses[]` | 无法识别归属的显存占用 |
| `effectiveFreeMB` | 调度可见的有效剩余显存 |

`pmeowTasks[]` 子字段：

| 字段 | 含义 |
| --- | --- |
| `taskId` | 任务 ID |
| `gpuIndex` | GPU 序号 |
| `declaredVramMB` | 任务声明需要的显存 |
| `actualVramMB` | 实际观测到的显存 |

`userProcesses[]` 子字段：

| 字段 | 含义 |
| --- | --- |
| `pid` | 进程 PID |
| `user` | 用户名 |
| `gpuIndex` | GPU 序号 |
| `usedMemoryMB` | 实际显存 |
| `command` | 命令行 |

`unknownProcesses[]` 子字段：

| 字段 | 含义 |
| --- | --- |
| `pid` | 进程 PID |
| `gpuIndex` | GPU 序号 |
| `usedMemoryMB` | 实际显存 |

##### `byUser[]`

| 字段 | 含义 |
| --- | --- |
| `user` | 用户名 |
| `totalVramMB` | 用户总显存占用 |
| `gpuIndices` | 涉及的 GPU 列表 |

补充说明：

- GPU 归因只按 `task.pid == gpu_process.pid` 精确匹配，不能覆盖任务子进程的 GPU 占用。
- GPU 进程采集使用 `nvidia-smi --query-compute-apps`，因此只覆盖 compute apps，不覆盖所有图形/显示类上下文。

### 1.4 `agent:taskUpdate`

这是任务镜像事件。payload 字段如下：

| 字段 | 含义 |
| --- | --- |
| `taskId` | 任务 ID |
| `status` | `queued`、`running`、`completed`、`failed`、`cancelled` |
| `command` | 任务命令字符串 |
| `cwd` | 工作目录 |
| `user` | 提交用户名 |
| `requireVramMB` | 每卡声明显存需求 |
| `requireGpuCount` | 需要 GPU 数量 |
| `gpuIds` | 已分配 GPU 列表 |
| `priority` | 优先级 |
| `createdAt` | 创建时间 |
| `startedAt` | 启动时间 |
| `finishedAt` | 结束时间 |
| `exitCode` | 退出码 |
| `pid` | 根进程 PID |

发送时机：

- 提交任务后发送 `queued`
- 普通 daemon shell 任务启动后发送 `running`
- attached_python 任务确认启动后发送 `running`
- 任务完成后发送 `completed` 或 `failed`
- 取消任务后发送 `cancelled`

补充说明：

- agent 本地模型存在 `launching` 状态，但当前不会把 `launching` 作为 `taskUpdate` 发给服务端。
- `taskUpdate` 不包含 `argv`、`env_overrides`、`launch_mode`、`report_requested`、`log_path`。
- 服务端在 `agent_tasks` 表里会做 merge，尽量保留旧的静态字段，避免后续仅带少数字段的状态更新把前面的元数据冲掉。

### 1.5 `agent:localUsers`

这是节点本地用户清单。payload 字段如下：

| 字段 | 含义 |
| --- | --- |
| `timestamp` | 采样时间 |
| `users[]` | 用户列表 |

`users[]` 子字段：

| 字段 | 含义 |
| --- | --- |
| `username` | 用户名 |
| `uid` | UID |
| `gid` | GID |
| `gecos` | GECOS |
| `home` | home 目录 |
| `shell` | 登录 shell |

补充说明：

- Python agent 发出时只带 `timestamp + users`；Web 侧会补上 `agentId` 和 `serverId`。
- agent 只在用户清单签名变化时才发送，不是每轮都发。
- 该 collector 依赖 Unix 的 `pwd` 模块；在 Windows 上会返回空列表。
- 服务端采用全量替换语义，不做增量 merge。

### 1.6 `agent:heartbeat`

payload 只有两个字段：

| 字段 | 含义 |
| --- | --- |
| `agentId` | agent 唯一标识 |
| `timestamp` | 心跳时间 |

补充说明：

- 时间戳来自 `time.time()`，单位是秒。
- Web 侧会把秒级时间规范化成毫秒。
- 断线状态下 heartbeat 不缓存，直接跳过。

## 二、服务端按需拉取、agent 再返回的数据

这类数据不是 agent 主动推送，而是 Web 侧通过 live session 发命令给 agent，agent 再通过 callback 返回。

当前唯一已实现的按需返回通道是：

- `server:getTaskEvents` -> agent 返回任务事件数组

### 2.1 `getTaskEvents` 返回结构

返回值是 `AgentTaskEventRecord[]`，每项包含：

| 字段 | 含义 |
| --- | --- |
| `id` | 事件自增 ID |
| `taskId` | 任务 ID |
| `eventType` | 事件类型 |
| `timestamp` | 事件时间 |
| `details` | 结构化 JSON，或 `null` |

### 2.2 当前已确认的任务事件类型

代码里明确会产生或返回下列事件类型：

| 事件类型 | 来源 | 典型 details |
| --- | --- | --- |
| `submitted` | 任务提交 | `message`、`user`、`cwd`、`argv`、`command`、`launch_mode`、`require_vram_mb`、`require_gpu_count`、`priority` |
| `queue_paused` | 队列暂停时的排队记录 | `message`、`reason_code=queue_paused` |
| `schedule_blocked` | 调度评估失败 | `message`、`reason_code`、`current_eligible_gpu_ids`、`sustained_eligible_gpu_ids`、`current_effective_free_mb`、`history_min_free_mb`、`pending_vram_mb`、`blocker_task_ids` |
| `launch_reserved` | attached_python 预留 GPU | 通常只有 `message` |
| `launch_reservation_expired` | daemon 检测到预留过期后补记 | 通常只有 `message` |
| `launch_deadline_expired` | store 层重排队时直接写入 | `details=null` |
| `priority_updated` | 修改优先级 | `message`、`old_priority`、`new_priority` |
| `attached_started` | attached_python 已启动 | 通常只有 `message` |
| `attached_finished` | attached_python 已结束 | 通常只有 `message` |

补充说明：

- 事件流里目前存在一组命名不完全一致的过期事件：`launch_deadline_expired` 和 `launch_reservation_expired`。两者都可能在同一条过期路径中出现。
- 这条按需接口返回的是结构化任务事件，不返回日志正文。

## 三、agent 通过本地 daemon socket 回给本机调用方的数据

这部分不是中心服务端通道，但从“agent 会回给调用方哪些数据”的角度，仍然应该单独列出。

### 3.1 本地 JSON-line RPC 方法

| 方法 | 返回数据 |
| --- | --- |
| `submit_task` | 新建任务的完整任务字典 |
| `list_tasks` | 任务数组 |
| `get_task` | 单个任务字典或 `null` |
| `get_task_events` | 任务事件数组 |
| `get_logs` | 任务日志文本 |
| `get_status` | 队列状态计数 |
| `cancel_task` | `bool` |
| `confirm_attached_launch` | `bool` |
| `finish_attached_task` | `bool` |
| `pause_queue` | `null` |
| `resume_queue` | `null` |

### 3.2 本地任务字典字段

`submit_task`、`list_tasks`、`get_task` 返回的是同一类任务字典，字段包括：

| 字段 | 含义 |
| --- | --- |
| `id` | 任务 ID |
| `command` | 命令字符串 |
| `cwd` | 工作目录 |
| `user` | 用户名 |
| `require_vram_mb` | 每卡显存需求 |
| `require_gpu_count` | 需要 GPU 数量 |
| `argv` | 参数数组 |
| `launch_mode` | `daemon_shell` 或 `attached_python` |
| `report_requested` | 是否启用等待阶段 report 输出 |
| `launch_deadline` | attached 预留截止时间 |
| `gpu_ids` | 已分配或预留的 GPU 列表 |
| `priority` | 优先级 |
| `status` | 任务状态 |
| `created_at` | 创建时间 |
| `started_at` | 启动时间 |
| `finished_at` | 结束时间 |
| `exit_code` | 退出码 |
| `pid` | 根进程 PID |
| `log_path` | 任务日志路径，仅 socket server 显式附加时返回 |

### 3.3 本地队列状态字段

`get_status` 返回：

| 字段 | 含义 |
| --- | --- |
| `paused` | 队列是否暂停 |
| `queued` | 排队任务数 |
| `running` | 运行中任务数 |
| `completed` | 已完成任务数 |
| `failed` | 已失败任务数 |
| `cancelled` | 已取消任务数 |

### 3.4 本地日志返回

`get_logs` 返回的是任务日志原文，不做结构化，也不做脱敏。

补充说明：

- `get_logs` 的 RPC 形参有 `tail`，但 `DaemonService.get_logs()` 当前没有把这个参数传给 `read_task_log()`，所以现状是“读全量日志”，不是“只读 tail”。

## 四、只保存在本地、不会镜像到中心服务端的数据

下面这些数据 agent 本地会保存或使用，但当前不会通过 `agent:taskUpdate` 或其他主动事件镜像到中心服务端：

| 数据 | 本地保存位置 | 是否主动上报 |
| --- | --- | --- |
| `env_overrides` / 完整 `os.environ` 快照 | 本地 SQLite `tasks.env_json` | 否 |
| `argv` 原始数组 | 本地 SQLite `tasks.argv_json` | 否 |
| `launch_mode` | 本地 SQLite `tasks.launch_mode` | 否 |
| `report_requested` | 本地 SQLite `tasks.report_requested` | 否 |
| `log_path` | 运行时计算，本地 RPC 可返回 | 否 |
| 任务日志正文 | 本地日志文件 | 否 |
| 队列暂停标志 | 本地 runtime store | 否 |

特别说明：

- `pmeow submit` 会把调用时的完整环境变量快照塞进 `env_overrides` 后提交给 daemon。
- 这些环境变量随后用于实际启动任务进程，但不会通过 `taskUpdate` 发到中心服务端。

## 五、回传时机、频率、缓冲与规范化

### 5.1 发送时机

- `register`：连接建立和重连后发送
- `metrics`：每次 `collect_cycle()` 结束发送
- `localUsers`：每轮先比较签名，只有变化时才发送
- `taskUpdate`：任务生命周期关键节点发送
- `heartbeat`：独立后台线程按 `heartbeat_interval` 发送

### 5.2 离线缓存

- transport 对 `register`、`metrics`、`taskUpdate`、`localUsers` 采用有界离线缓存，最大 100 条。
- 重连后会先 flush buffer，再重新执行 `send_register()`。
- `heartbeat` 不入缓存，断线时直接跳过。

### 5.3 时间戳规范化

- Python agent 侧大量使用 `time.time()`，天然是秒级浮点时间戳。
- Web 侧在 `agent-namespace` 中会把 metrics、taskUpdate、localUsers、heartbeat 的时间统一规范化成毫秒整数，避免前端和数据库出现秒/毫秒混用。

### 5.4 `serverId` 规范化

- `agent:register` 没有 `serverId`。
- `agent:metrics` 的 `serverId` 由 agent 自己填成 `config.agent_id` 或 `local`，但 Web 侧会根据 live binding 强制对齐到已绑定的 serverId。
- `agent:taskUpdate`、`agent:localUsers` 即使原始 payload 缺失 `serverId`，Web 侧也会补全成绑定后的 serverId。

## 六、审计发现与审阅建议

### 6.1 已确认的事实

1. README 中对外事件说明已经过时，漏写了 `agent:localUsers`。
2. 任务日志和完整任务事件流不会主动上传；只有任务状态摘要会镜像到服务端。
3. 本地 CLI 提交会冻结一份完整环境变量快照到本地库，这比服务端镜像看到的信息多得多。

### 6.2 建议重点审阅的风险点

1. `processes[].command` 和 `gpuAllocation.userProcesses[].command` 都可能包含敏感命令行参数。
2. `env_overrides` 把完整环境变量快照保存在本地 SQLite，可能包含 token、密钥或代理配置。
3. `gpuAllocation` 只按任务根 PID 精确匹配，任务子进程的 GPU 占用可能被记成普通用户进程或未知进程。
4. `processes[]` 缺少进程树字段，无法可靠做 CPU/内存层面的任务子进程归属。
5. `get_logs` 当前读全量日志，如果日志中含敏感输出，本地读取面没有额外保护。
6. 默认互联网探测会主动访问公网地址，在严格内网或安全敏感环境中应评估是否需要关闭。

## 七、证据文件

本报告主要依据以下源码文件：

- `agent/pmeow/transport/client.py`
- `agent/pmeow/daemon/service.py`
- `agent/pmeow/daemon/socket_server.py`
- `agent/pmeow/models.py`
- `agent/pmeow/collector/snapshot.py`
- `agent/pmeow/collector/cpu.py`
- `agent/pmeow/collector/memory.py`
- `agent/pmeow/collector/disk.py`
- `agent/pmeow/collector/network.py`
- `agent/pmeow/collector/gpu.py`
- `agent/pmeow/collector/gpu_attribution.py`
- `agent/pmeow/collector/processes.py`
- `agent/pmeow/collector/local_users.py`
- `agent/pmeow/collector/internet.py`
- `agent/pmeow/store/tasks.py`
- `agent/pmeow/__main__.py`
- `packages/core/src/types.ts`
- `packages/core/src/agent/protocol.ts`
- `packages/core/src/agent/ingest.ts`
- `packages/core/src/db/agent-tasks.ts`
- `packages/core/src/agent/binding.ts`
- `packages/core/src/datasource/agent-datasource.ts`
- `packages/web/src/agent-namespace.ts`
- `packages/web/src/agent-routes.ts`
