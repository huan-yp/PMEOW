# PMEOW 开发文档

这一组文档面向需要修改代码、排查实现问题或扩展协议的贡献者。

## 建议阅读顺序

如果你刚接手这个仓库，建议按下面顺序阅读：

1. [architecture.md](architecture.md) - 先建立系统边界和运行模型。
2. [local-development.md](local-development.md) - 再把本地开发环境和命令链路跑通。
3. [protocol-and-api.md](protocol-and-api.md) - 了解 REST、Socket.IO 和 Agent 协议。
4. [testing-and-debugging.md](testing-and-debugging.md) - 最后掌握测试入口和常见坑。

## 当前文档覆盖什么

开发文档目前聚焦于当前已经落地的实现：

- Monorepo 结构和各 package 职责
- Web 服务端、Core、UI、Python Agent 的协作方式
- 数据流、鉴权、节点绑定、任务控制和安全事件链路
- 本地开发、构建、测试与调试方法
- GitHub Actions、PyPI、npm 和 Docker 的发版入口

## 什么不在这里

下面这些内容仍然应该回到设计档案中查看：

- 为什么选择 V2 当前路线
- 阶段性计划和未落地的能力清单
- 历史架构对比与产品演进讨论

这些信息保存在 `docs/superpowers/` 下。正式开发时，如果设计档案与当前代码冲突，应优先相信源码和包脚本，再回过头更新文档。

## 文档维护约定

如果你修改了下面这些内容，应该同步更新开发文档：

- 启动命令、构建命令、测试命令
- REST 路由和 Socket.IO 事件
- Agent 注册/绑定/心跳语义
- 任务队列和安全审计的用户可见行为

对应地，如果你修改了管理员工作流或页面行为，也要同时更新 `docs/user/` 中的相关页面。

当前的 CI 与发版说明已经整理在 [local-development.md](local-development.md) 中，包含 tag 规则、版本源和 GitHub 侧前置配置。