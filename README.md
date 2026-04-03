# PMEOW

<img align="right" width="400" src="assets/logo.png" alt="PMEOW — 面向高校实验室的 GPU 集群调度系统">

PMEOW 是面向实验室和小型 GPU 集群的监控与节点本地调度平台。当前 main 上已经落地的是一个两层系统：Web 服务端负责集群可见性、最小控制面和管理入口，Python Agent 运行在计算节点本地，负责指标采集、GPU 归属识别、本地任务队列和自主调度。

服务端是观察者和干预点，不替 Agent 做二次排队调度。调度权仍然留在节点侧。

<br clear="both">

## 当前已落地能力

- Web 控制台：控制台、节点、人员、钩子规则、告警、任务调度、安全审计、设置。
- 双节点接入模式：同一个系统同时支持 SSH 节点和 Agent 节点，并允许逐台迁移。
- Agent 本地执行链路：指标采集、任务镜像、GPU allocation、取消、暂停、恢复和优先级控制。
- People 与 access：人员目录、绑定向导、人员详情、移动端访问令牌生命周期。
- 移动端入口：管理员移动视图和个人移动视图，Android 可通过 Capacitor 打包。

## 最短启动路径

### 从仓库本地试跑

准备 Node.js 20+、pnpm 9+；如果还要接入 Agent 节点，再准备 Python 3.10+。

```bash
pnpm install

# 终端 1
pnpm dev:web

# 终端 2
pnpm dev:ui
```

打开 `http://localhost:5173`。第一次进入登录页时，输入的密码会被作为管理员密码初始化。

### 接近生产的 Web 启动

```bash
pnpm build:web
pnpm start:web
```

默认监听 `http://localhost:17200`。

### 发行包与 Docker

```bash
npm install -g pmeow-web
pmeow-web

docker compose up -d
```

## 第一次接入节点

- SSH 节点：在“节点”页面新增服务器，填写 `host`、`port`、`username` 和私钥路径，先跑一次测试连接。
- Agent 节点：先在 Web 端创建服务器记录，并让 `host` 与节点真实 hostname 一致；随后在节点上安装 `pmeow-agent`，设置 `PMEOW_SERVER_URL`，再执行 `pmeow-agent run`。

如果 hostname 唯一精确匹配，服务端会把该服务器切换到 Agent 模式，并开始显示任务和 GPU allocation 数据。

## 文档导航

- [docs/README.md](docs/README.md) - 文档总入口，按任务找文档
- [docs/user/getting-started.md](docs/user/getting-started.md) - 5 到 10 分钟完成第一次试跑
- [docs/user/web-server.md](docs/user/web-server.md) - Web 服务端部署、数据路径和认证
- [docs/user/agent-nodes.md](docs/user/agent-nodes.md) - Agent 节点安装、systemd 和本地 CLI
- [docs/user/web-console.md](docs/user/web-console.md) - Web 控制台页面地图与使用边界
- [docs/user/people-and-access.md](docs/user/people-and-access.md) - 人员目录、绑定关系和移动端令牌
- [docs/user/mobile-app.md](docs/user/mobile-app.md) - 管理员与个人移动端入口
- [docs/developer/README.md](docs/developer/README.md) - 架构、开发、协议、测试

`docs/superpowers/` 保留为设计与规划档案，不替代当前操作手册。
