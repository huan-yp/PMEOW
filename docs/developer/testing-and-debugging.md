# 测试与调试指南

这份文档关注三个问题：

- 当前有哪些测试入口
- 运行测试时最常见的隔离坑是什么
- 出现运行时问题时，应该去哪里看状态和日志

## 测试入口

### 根级快捷命令

在仓库根目录下，最常用的是：

```bash
pnpm test:core
pnpm test:web
pnpm typecheck:core
pnpm typecheck:web
```

注意：当前根脚本没有 `test:ui`，UI 测试需要直接跑包级命令。

### 包级 TypeScript 测试

- `packages/core` 使用 Vitest，适合验证共享模型、数据库逻辑、数据源、调度器和安全处理。
- `packages/web` 使用 Vitest，适合验证 Web runtime、REST route、Agent namespace 和集成行为。
- `packages/ui` 也有测试基础设施，适合验证人员向导、移动端视图和关键交互。

常用包级命令：

```bash
pnpm --filter @monitor/core test
pnpm --filter @monitor/web test
pnpm --filter @monitor/ui test
```

### Python Agent 测试

```bash
cd agent
. .venv/bin/activate
pytest -v
```

Agent 侧测试主要覆盖：

- collector
- queue scheduler
- executor runner
- daemon service
- transport client
- e2e smoke

## 推荐的最小回归组合

如果你改的是：

- `packages/core`：至少跑 `pnpm test:core` 和 `pnpm typecheck:core`
- `packages/web`：至少跑 `pnpm test:web` 和 `pnpm typecheck:web`
- `packages/ui`：至少跑 `pnpm --filter @monitor/ui test` 和 `pnpm --filter @monitor/ui typecheck`
- Web 与 Core 的共享协议：同时跑 `pnpm test:core`、`pnpm test:web`
- People、移动端或控制台流程：优先补跑 `pnpm --filter @monitor/ui test`
- Agent 协议或调度：跑 `pytest -v`，必要时再联调一份 Web 实例

## 当前最值得信的几类测试

如果你需要找“当前 main 上到底怎么工作的”证据，下面几类测试最有参考价值：

- `packages/ui/tests/person-create-wizard.test.tsx`：人员创建向导、绑定迁移确认
- `packages/web/tests/agent-integration.test.ts`：Agent 注册、hostname 绑定、serverId 规范化、命令分发
- `agent/tests/` 下的调度与 daemon 用例：Agent 本地队列和执行语义

这些测试对文档也很重要，因为它们把当前实际行为固定了下来。

## 已验证的测试隔离约束

下面这些不是“建议”，而是这个仓库已经踩过坑后的经验结论。

### Web runtime 测试要隔离数据库

如果测试会直接启动 `createWebRuntime()`，建议对每个测试用例显式设置：

```text
process.env.MONITOR_DB_PATH=':memory:'
```

并在 `afterEach` 中调用 `closeDatabase()`。

原因很直接：

- 如果复用磁盘数据库，之前遗留的 `servers` 记录可能继续存在
- Agent hostname 绑定会因为重复 host 匹配失败
- 这种失败表面上像协议问题，实际上只是测试污染

### Core 测试在写入 `metrics` 或 `gpu_usage_stats` 前要先建 `server` 记录

`metrics` 和 `gpu_usage_stats` 都受到 `servers` 外键约束。直接写这些表之前，如果没有先创建 server 记录，测试会失败。

### `packages/core` 的 `tsc --noEmit` 不覆盖 tests

当前 `packages/core/tsconfig.json` 只包含 `src`。这意味着：

- `pnpm typecheck:core` 不能替你检查 `tests` 目录里的所有类型问题
- 如果你希望某个编译期约束被 `tsc --noEmit` 强制执行，相关断言应位于 `src` 或由运行时测试补足

## 运行时调试地图

### 服务端

最先看的通常是：

- 当前前台日志或容器日志
- SQLite 数据库路径
- `data/keys/` 是否存在正确上传的 SSH 密钥

默认情况下：

- 数据库在 `data/monitor.db`
- 如果设置了 `MONITOR_DB_PATH`，则以环境变量为准

### Agent 节点

最先看的通常是：

- `~/.pmeow/pmeow.db`
- `~/.pmeow/pmeow.sock`
- `~/.pmeow/logs/`
- daemon 前台输出或 systemd journal

如果问题和任务运行有关，优先看本地日志，而不是服务端 UI。

### 移动端与人员链路

如果问题涉及 `/m/admin`、`/m/me`、令牌或向导流程，最先看的通常是：

- 当前浏览器或原生壳是否保存了正确的服务器地址
- 管理员 JWT 或 Person Token 是否有效
- 人员绑定关系是否真实存在

## 几个高频调试场景

### 登录态异常

现象：重启服务后浏览器突然全部重新登录。

先检查：是否设置了稳定的 `JWT_SECRET`。

### Agent 明明在线却被服务端判定离线

先检查：

- Agent 是否仍在发送 heartbeat
- heartbeat 时间戳单位是否被错误修改
- 服务端是否仍在做秒到毫秒的规范化

当前 Python Agent 使用 `time.time()` 发送心跳，服务端会先把秒级时间戳转换为毫秒再做超时比较。

### Agent 绑定异常

先检查：

- Web 数据库里的 `servers.host` 是否与节点 hostname 精确一致
- 是否存在重复 host 的服务器记录
- 当前测试或本地数据库是否被旧数据污染

### 任务调度页与节点本地状态不一致

先检查：

- 最近一次 `agent:taskUpdate` 是否真的发出
- Web 端是否成功 `ingestAgentTaskUpdate`
- 目标节点是否还保有 live session 会话

要记住，服务端任务列表是镜像视图，不是节点本地数据库本身。

### 人员向导或移动端行为异常

先检查：

- UI 侧的人员向导测试是否已经覆盖到当前改动
- 绑定迁移是否需要额外确认
- 个人令牌是否已经被轮换或吊销

## 一个实用的排查顺序

如果你遇到的是跨层问题，建议按这个顺序缩小范围：

1. 先确认进程是否活着。
2. 再确认本地数据文件和路径是否正确。
3. 然后确认 REST 或 Socket 事件是否真的发生。
4. 最后才怀疑 UI 渲染、调度策略、归属规则或安全规则本身。

这个顺序的好处是可以尽快判断问题属于“没跑起来”“没连上”“没持久化”还是“业务逻辑不对”。