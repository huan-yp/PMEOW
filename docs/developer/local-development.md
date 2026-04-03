# 本地开发指南

这份文档描述当前仓库最直接、最稳定的开发方式，默认使用 `pnpm` 管理 TypeScript Monorepo，使用 Python 虚拟环境管理 Agent。

## 前置条件

建议至少准备下面这些工具：

- Node.js 20+
- pnpm 9+
- Python 3.10+
- 可选：Docker 和 docker compose，用于验证打包与部署路径

## 仓库初始化

### TypeScript Monorepo

在仓库根目录执行：

```bash
pnpm install
```

这会安装 `packages/core`、`packages/ui` 和 `packages/web` 所需依赖。

### Python Agent

Agent 不在 pnpm workspace 内，需要单独初始化：

```bash
cd agent
python3 -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
```

## 推荐的本地运行布局

### 只调 Web 和 UI

```bash
# 终端 1
pnpm dev:web

# 终端 2
pnpm dev:ui
```

说明：

- `pnpm dev:web` 会在 `packages/web` 下用 `tsx watch` 运行服务端
- `pnpm dev:ui` 会启动 Vite 开发服务器
- 浏览器入口通常是 `http://localhost:5173`

### 运行接近生产的 Web 实例

```bash
pnpm build:web
pnpm start:web
```

这个路径适合验证：

- 构建产物是否完整
- `packages/web/dist/public` 是否正确包含 UI 静态资源
- 不依赖 Vite 的纯服务端部署链路是否正常

### 单独开发 Agent

```bash
cd agent
. .venv/bin/activate
pmeow-agent daemon
```

如果你只想跑 Agent 测试而不连接真实服务端，可以保持 `PMEOW_SERVER_URL` 为空，专注于本地 socket、队列和采集层测试。

## 常用命令速查

### 根级命令

```bash
pnpm dev:web
pnpm dev:ui
pnpm build:web
pnpm start:web
pnpm test:core
pnpm test:web
pnpm typecheck:core
pnpm typecheck:web
```

### 包级命令

如果你只想针对某个 package 工作，也可以进入对应目录执行包级脚本：

- `packages/core`: `build`, `dev`, `test`, `test:watch`, `typecheck`
- `packages/web`: `dev`, `build`, `start`, `test`, `test:watch`, `typecheck`
- `packages/ui`: `dev`, `build`, `test`, `typecheck`

### Agent 命令

```bash
cd agent
. .venv/bin/activate
pytest -v

# 交互验证 CLI
pmeow-agent status
pmeow-agent submit --pvram 4000 --gpu 1 -- python train.py
```

## 本地环境变量

### Web 服务端

开发时最常见的是：

- `PORT`
- `MONITOR_DB_PATH`
- `JWT_SECRET`

建议：

- 需要隔离数据库时，为当前 shell 显式设置 `MONITOR_DB_PATH`
- 需要跨重启保留登录态时，为当前 shell 显式设置 `JWT_SECRET`

### Agent

开发 Agent 时最常见的是：

- `PMEOW_SERVER_URL`
- `PMEOW_AGENT_ID`
- `PMEOW_STATE_DIR`
- `PMEOW_SOCKET_PATH`
- `PMEOW_LOG_DIR`

如果你同时跑多个本地 Agent 实例，一定要给它们分配不同的状态目录和 socket 路径，否则很容易互相污染。

## 本地数据位置

### Web 服务端

默认情况下，服务端会把 SQLite 放在当前工作目录下：

```text
data/monitor.db
```

上传的 SSH 密钥默认放在：

```text
data/keys/
```

### Agent

默认情况下，Agent 会把本地状态放在：

```text
~/.pmeow/
```

其中包括本地 SQLite、Unix socket 和任务日志。

## 几种典型开发路径

### 改 UI 页面

优先运行：

- `pnpm dev:ui`
- `pnpm dev:web`

如果只是改静态展示逻辑，大多数情况下不需要单独 build。

### 改 REST API 或服务端行为

优先运行：

- `pnpm dev:web`
- `pnpm test:web`
- `pnpm typecheck:web`

如果改动涉及共享模型或核心逻辑，还需要补跑 `pnpm test:core`。

### 改共享模型或调度器

优先运行：

- `pnpm test:core`
- `pnpm typecheck:core`
- `pnpm test:web`

因为 `core` 改动很容易影响 Web 侧路由和 UI 传输层。

### 改 Agent

优先运行：

- `pytest -v`
- 本地 `pmeow-agent daemon`
- 如果涉及协议变化，再联调一份 Web 服务

## 开发时的几个稳定做法

1. 不要把 Agent 开发和 Web 开发混在一个共享状态目录里，隔离路径更省事。
2. 改协议时同时更新 Web 端、Agent 端和文档，不要只改单边。
3. 需要验证登录态时优先固定 `JWT_SECRET`，否则重启后容易误判为前端问题。
4. 需要验证生产链路时用 `pnpm build:web && pnpm start:web`，不要只看开发服务器是否正常。