# PMEOW 文档中心

PMEOW 当前的正式文档分成三层：

- 顶层 [../README.md](../README.md) 负责项目简介、当前能力和最短启动路径。
- `docs/user/` 面向管理员、运维和计算节点使用者，重点回答“怎么部署、怎么接入、怎么用”。
- `docs/developer/` 面向贡献者和维护者，重点回答“系统怎么工作、如何本地开发、接口和测试如何对齐”。

## 建议阅读路径

如果你是第一次接触 PMEOW：

1. 先读 [../README.md](../README.md) 了解项目范围。
2. 再读 [user/getting-started.md](user/getting-started.md) 完成第一次试跑。
3. 根据你的角色继续阅读用户文档或开发文档。

## 用户文档

- [user/README.md](user/README.md) - 用户文档入口与阅读顺序
- [user/getting-started.md](user/getting-started.md) - 5 到 10 分钟完成第一次试跑
- [user/web-server.md](user/web-server.md) - Web 服务端部署、持久化与认证说明
- [user/agent-nodes.md](user/agent-nodes.md) - Agent 节点安装、配置、systemd 和 CLI 工作流
- [user/web-console.md](user/web-console.md) - Web 控制台页面导览与操作说明
- [user/troubleshooting.md](user/troubleshooting.md) - 常见问题、排障路径与运维提示

## 开发文档

- [developer/README.md](developer/README.md) - 开发文档入口与阅读建议
- [developer/architecture.md](developer/architecture.md) - 当前架构、运行边界与关键数据流
- [developer/local-development.md](developer/local-development.md) - 本地开发、构建与环境配置
- [developer/protocol-and-api.md](developer/protocol-and-api.md) - REST、Socket.IO、Agent 协议与共享术语
- [developer/testing-and-debugging.md](developer/testing-and-debugging.md) - 测试入口、隔离约束与调试方法

## 设计与规划档案

`docs/superpowers/` 保留为设计和实施档案，不替代正式手册：

- `docs/superpowers/specs/` 记录架构设计背景，例如 V2 设计文档。
- `docs/superpowers/plans/` 记录阶段性计划与实施拆解。

如果正式文档和规划档案看起来有冲突，应以代码实现、包脚本和本目录下的正式文档为准，并在后续维护中补齐差异。