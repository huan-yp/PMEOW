# PMEOW 用户文档

这一组文档主要面向两类读者：

- Web 管理员或实验室运维，负责部署服务端、接入节点、查看状态和处理告警。
- 计算节点使用者或实验室成员，主要通过本地 `pmeow-agent` CLI、人员绑定和个人移动端参与使用。

## 按角色阅读

### 管理员 / 运维

1. [getting-started.md](getting-started.md) - 先把系统跑起来并完成一次最小验证。
2. [web-server.md](web-server.md) - 决定服务端以本地方式、Docker 方式还是发行包方式部署。
3. [agent-nodes.md](agent-nodes.md) - 让一台真实计算节点接入系统。
4. [web-console.md](web-console.md) - 熟悉控制台、节点、任务调度和安全审计等页面入口。
5. [people-and-access.md](people-and-access.md) - 管理人员档案、绑定关系和移动端访问令牌。
6. [mobile-app.md](mobile-app.md) - 了解管理员和个人移动端的连接路径。
7. [troubleshooting.md](troubleshooting.md) - 值班和排障参考。

### 节点使用者 / 实验室成员

1. [agent-nodes.md](agent-nodes.md) - 了解本地 `pmeow-agent` CLI、任务提交和日志读取。
2. [people-and-access.md](people-and-access.md) - 了解自己的人员归属如何建立，以及令牌由谁发放。
3. [mobile-app.md](mobile-app.md) - 使用个人移动端查看自己的任务、节点和通知。
4. [troubleshooting.md](troubleshooting.md) - 排查令牌、连接和队列问题。

## 文档边界

- [web-console.md](web-console.md) 负责说明页面地图和控制面边界，不展开每一种完整工作流。
- [people-and-access.md](people-and-access.md) 负责说明人员档案、绑定关系和移动端令牌生命周期。
- [agent-nodes.md](agent-nodes.md) 负责说明节点接入、本地 daemon 和 CLI。
- [mobile-app.md](mobile-app.md) 负责说明管理员与个人移动端的认证和连接路径。

架构设计背景、协议细节和测试约束放在 [../developer/README.md](../developer/README.md) 中。