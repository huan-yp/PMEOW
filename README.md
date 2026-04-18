# PMEOW | PALM 编排负载管理引擎

<img align="right" width="400" src="assets/logo.png" alt="PMEOW — 面向高校实验室的 GPU 集群调度系统">

PMEOW 是面向实验室和小型 GPU 集群的监控与节点本地调度平台。由 [I++ 俱乐部](https://ippclub.org/) 依托东南大学 [PALM 实验室](https://palm.seu.edu.cn/) 开发，旨在提供一个轻量级、易部署、功能实用的解决方案，帮助实验室管理员和研究人员更高效地管理和使用 GPU 资源。

**本项目采用 GNU Affero General Public License v3.0（AGPLv3，AGPL-3.0-only）。如需以闭源方式集成，或希望获得替代商业授权，请联系作者。**

<br clear="both">

## 快速部署

**务必注意网络安全！！！！**

本方式只适合快速体验，**不建议在生产环境使用**。

### 启动 Web 服务端

```bash
pnpm build:web
pnpm run:web
```

其中 `pnpm build:web` 会统一编排 `apps/web` 和 `server/runtime` 所需依赖，`pnpm run:web` 由根目录脚本启动后端并托管 `apps/web/dist`。

默认绑定 `0.0.0.0:17200`，本机访问可用 `http://localhost:17200`。

首次访问时会要求设置密码，**请设置强密码**。

### 接入计算节点

在节点上安装 `pmeow-agent`，设置环境变量 `PMEOW_SERVER_URL` 为 Web 服务端地址（例如 `http://localhost:17200`），再执行 `pmeow-agent run`（前台运行）。

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

## 关于我们

- [I++ 俱乐部](https://ippclub.org/)
- [PALM 实验室](https://palm.seu.edu.cn/)

## 合作与商业授权

如果您是高校实验室管理员，欢迎您联系我们定制化部署 PMEOW。

如果您是企业用户并希望闭源商用，请联系我们商讨商业授权事宜。

[电子邮件](mailto:huan_yp@qq.com)


