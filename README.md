# PMEOW | PALM 编排负载管理引擎

<img align="right" width="400" src="assets/logo.png" alt="PMEOW — 面向高校实验室的 GPU 集群调度系统">

PMEOW 是面向实验室和小型 GPU 集群的监控与节点本地调度平台。依托东南大学 [PALM 实验室](https://palm.seu.edu.cn/) 开发，旨在提供一个轻量级、易部署、功能实用的解决方案，帮助实验室管理员和研究人员更高效地管理和使用 GPU 资源。

<br clear="both">

## 当前已落地能力

- Web 控制台：控制台、节点、人员、钩子规则、告警、任务调度、安全审计、设置。
- 双节点接入模式：同一个系统同时支持 SSH 节点和 Agent 节点，并允许逐台迁移。
- Agent 本地执行链路：指标采集、任务镜像、GPU allocation、取消、暂停、恢复和优先级控制。
- People 与 access：人员目录、绑定向导、人员详情、移动端访问令牌生命周期。
- 移动端入口：管理员移动视图和个人移动视图，Android 可通过 Capacitor 打包。

### 启动 Web 服务端

```bash
pnpm build:web
pnpm start:web
```

**注意网络安全问题！！！**

默认绑定 `0.0.0.0:17200`，本机访问可用 `http://localhost:17200`。

生产环境使用请看 [Web 服务端部署文档](docs/user/web-server.md)。

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
## 开源协议





