# PMEOW

<img align="right" width="400" src="assets/logo.png" alt="PMEOW — 面向高校实验室的 GPU 集群调度系统">

PAML 实验室 GPU 集群监控与本地调度平台。

PAML Manage Engine for Orchestrated Workloads (PMEOW) 是一个专为高校实验室设计的 GPU 集群监控与调度系统。它提供了一个轻量级的 Python Agent，直接运行在计算节点上，负责指标采集、GPU 归属识别、本地任务队列和自主调度。Web 服务端则提供了一个统一的界面，展示跨节点的任务队列、GPU 使用分布、安全审计视图等功能。

当前实现采用两层架构：

- Web 服务端负责监控汇聚、告警、钩子、Agent 接入、任务镜像和最小控制面
- Python Agent 运行在计算节点本地，负责指标采集、GPU 归属识别、本地任务队列、执行器和自主调度

服务端是观察者和干预点，不负责替 Agent 做二次排队调度。

<br clear="both">

## Operator Visibility Surface

- Tasks：新增跨 Agent 节点的任务队列视图，按服务器聚合 queued、running、recent 三类任务，并支持取消任务、提高优先级、暂停队列、恢复队列。
- Security：新增安全审计视图，汇总可疑进程与无主 GPU 占用事件，支持按节点与时间窗口筛选，并允许操作员将事件标记为安全。
- Overview：总览页新增 GPU 使用分布卡片，展示当前集群按用户聚合的显存占用、任务数和非任务进程占用情况。
- Server Detail：节点详情页新增 Tasks tab、GPU 分配条和进程审计表，可同时查看 PMEOW 任务占用、用户进程占用、未知占用以及可疑原因。
- Settings：设置页新增安全审计配置，展示挖矿关键词、无归属 GPU 持续分钟阈值、高 GPU 利用率阈值与持续时间等字段，并补充 Agent 部署说明；当前安全审计检测已接入的是挖矿关键词和无归属 GPU 持续分钟阈值，高 GPU 利用率相关字段仍为预留设置项。

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
- npm >= 10 或 pnpm >= 9
- Python >= 3.10（仅 Agent 节点需要）

### 安装 Monorepo 依赖

```bash
# npm
npm install

# pnpm
pnpm install
```

### 本地开发

```bash
# npm
# 终端 1: Web 后端
npm run dev:web

# 终端 2: UI 开发服务器
npm run dev:ui

# pnpm
# 终端 1: Web 后端
pnpm dev:web

# 终端 2: UI 开发服务器
pnpm dev:ui
```

访问 `http://localhost:5173`。首次打开 Web 界面会要求设置密码。

### 生产启动 Web 服务

```bash
# npm
npm run build:web
npm run start:web

# pnpm
pnpm build:web
pnpm start:web
```

默认监听 `http://localhost:17200`。

### Docker 部署

```bash
docker compose up -d
```

## 文档导航

README 只保留项目概览、能力摘要和最短启动路径，详细文档集中放在 `docs/` 下：

- [docs/README.md](docs/README.md) - 文档总索引
- [docs/user/README.md](docs/user/README.md) - 面向管理员与节点使用者的用户文档
- [docs/developer/README.md](docs/developer/README.md) - 面向贡献者的开发文档

其中 `docs/superpowers/` 保留为设计与规划档案，用于记录 V2 设计背景和实施计划，不作为当前操作手册。

## Agent 节点接入

Agent 项目位于 `agent/`。节点侧安装、环境变量、systemd 部署与 CLI 工作流可同时参考 [agent/README.md](agent/README.md) 和 [docs/user/agent-nodes.md](docs/user/agent-nodes.md)。

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

## Operator APIs

只读与查询接口：

- `GET /api/task-queue`
- `GET /api/servers/:id/process-audit`
- `GET /api/security/events`
- `GET /api/gpu-overview`
- `GET /api/gpu-usage/summary`
- `GET /api/gpu-usage/by-user`
- `GET /api/servers/:id/tasks`
- `GET /api/servers/:id/tasks/:taskId`
- `GET /api/servers/:id/gpu-allocation`

控制接口：

- `POST /api/security/events/:id/mark-safe`
- `POST /api/servers/:id/tasks/:taskId/cancel`
- `POST /api/servers/:id/queue/pause`
- `POST /api/servers/:id/queue/resume`
- `POST /api/servers/:id/tasks/:taskId/priority`

## 测试

```bash
# npm
npm run test:core
npm run test:web
npm run typecheck:core
npm run typecheck:web

# pnpm
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
