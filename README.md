# PMEOW

实验室 GPU 集群监控与本地调度平台。

当前实现采用两层架构：

- Web 服务端负责监控汇聚、告警、钩子、Agent 接入、任务镜像和最小控制面
- Python Agent 运行在计算节点本地，负责指标采集、GPU 归属识别、本地任务队列、执行器和自主调度

服务端是观察者和干预点，不负责替 Agent 做二次排队调度。

## 当前能力

- SSH 与 Agent 双数据源并存，可按节点逐步从 SSH 切换到 Agent
- Web 端可接收 `/agent` Socket.IO 命名空间连接并按 hostname 自动绑定节点
- Agent 指标支持 `gpuAllocation` 持久化，服务端会同时保存完整 metrics 和展平后的 `gpu_usage_stats`
- 服务端已提供最小任务读 API 和控制 API：任务列表、单任务、GPU allocation、取消任务、暂停/恢复队列、调整优先级
- GPU 钩子、告警、历史指标、设置管理仍保留现有能力

## 技术栈

| 层 | 技术 |
|---|---|
| 核心 | TypeScript, better-sqlite3, ssh2 |
| Web 服务 | Express, Socket.IO, JWT |
| 前端 | React 18, TypeScript, Tailwind CSS, Zustand, ECharts |
| 节点 Agent | Python 3.10+, psutil, python-socketio |

## 快速开始

### 环境要求

- Node.js >= 20
- pnpm >= 9
- Python >= 3.10（仅 Agent 节点需要）

### 安装 Monorepo 依赖

```bash
pnpm install
```

### 本地开发

```bash
# 终端 1: Web 后端
pnpm dev:web

# 终端 2: UI 开发服务器
pnpm dev:ui
```

访问 `http://localhost:5173`。首次打开 Web 界面会要求设置密码。

### 生产启动 Web 服务

```bash
pnpm build:web
pnpm start:web
```

默认监听 `http://localhost:17200`。

### Docker 部署

```bash
docker compose up -d
```

## Agent 节点接入

Agent 项目位于 `agent/`，详细说明见 [agent/README.md](agent/README.md)。

最小启动流程：

```bash
cd agent
python3 -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"

export PMEOW_SERVER_URL=http://your-server:17200
pmeow-agent daemon
```

Agent 会通过 Socket.IO `/agent` namespace 连接服务端，并按 `PMEOW_AGENT_ID` 或 hostname 建立身份。服务端对 `servers.host` 做精确匹配；唯一匹配时会自动把该服务器切换到 Agent 模式。

## 已落地的 Agent 后端接口

只读接口：

- `GET /api/servers/:id/tasks`
- `GET /api/servers/:id/tasks/:taskId`
- `GET /api/servers/:id/gpu-allocation`

控制接口：

- `POST /api/servers/:id/tasks/:taskId/cancel`
- `POST /api/servers/:id/queue/pause`
- `POST /api/servers/:id/queue/resume`
- `POST /api/servers/:id/tasks/:taskId/priority`

这些接口只在目标服务器存在、目标任务存在（任务相关接口）且 live Agent session 已附着时返回成功；不会对镜像任务状态做乐观写入。

## 测试

```bash
pnpm --filter @monitor/core test
pnpm --filter @monitor/web test
pnpm --filter @monitor/core exec tsc --noEmit
pnpm --filter @monitor/web exec tsc --noEmit
```

Agent 测试：

```bash
cd agent
. .venv/bin/activate
pytest -v
```

## 项目结构

```text
agent/            Python Agent：采集、队列、执行、Socket.IO transport
packages/
  core/           共享核心：DB、scheduler、datasource、Agent protocol/binding/ingest
  ui/             React UI
  web/            Express + Socket.IO Web 服务
```
