# PMEOW 用户文档

这一组文档主要面向两类读者：

- Web 管理员或实验室运维，负责部署服务端、接入节点、查看状态和处理告警。
- 计算节点使用者，主要通过本地 `pmeow-agent` CLI 提交任务、查看队列和读取日志。

## 推荐阅读顺序

第一次接触项目时，建议按下面顺序阅读：

1. [getting-started.md](getting-started.md) - 先把系统跑起来并完成一次最小验证。
2. [web-server.md](web-server.md) - 决定服务端以本地方式还是 Docker 方式部署。
3. [agent-nodes.md](agent-nodes.md) - 让一台真实计算节点接入系统。
4. [web-console.md](web-console.md) - 熟悉页面、操作入口和使用边界。
5. [troubleshooting.md](troubleshooting.md) - 作为值班和排障参考。

## 文档范围

用户文档只解释当前已经落地的能力：

- Web 服务端的启动、持久化、认证与节点接入。
- SSH 节点和 Agent 节点的使用方式。
- 任务队列、GPU 使用概览、安全审计、告警与钩子规则。
- 常见失败场景和排障建议。

架构设计背景、协议细节和测试约束放在 [../developer/README.md](../developer/README.md) 中。