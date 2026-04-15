# PMEOW 开发文档

这一组文档面向需要修改代码、排查实现问题或扩展协议的贡献者。这里的内容只描述当前 main 上已经落地的实现，不承担历史设计说明或路线图职责。

## 建议阅读顺序

如果你刚接手这个仓库，建议按下面顺序阅读：

1. [architecture.md](architecture.md) - 先建立系统边界、运行模型和认证边界。
2. [local-development.md](local-development.md) - 再把本地开发环境、命令链路和发布入口跑通。
3. [protocol-and-api.md](protocol-and-api.md) - 了解 REST、Socket.IO、移动端和 Agent 协议。
4. [testing-and-debugging.md](testing-and-debugging.md) - 最后掌握测试入口、隔离约束和调试顺序。

## 当前文档覆盖什么

开发文档目前聚焦于当前已经落地的实现：

- Monorepo 结构和各 package 职责。
- Web 服务端、Core、UI、Python Agent 的协作方式。
- 管理员桌面端、管理员移动端、个人移动端和 Agent 的认证边界。
- 数据流、节点绑定、任务控制、安全事件和人员归属链路。
- Bucketed 历史查询、任务事件拉取、告警抑制和安全事件回滚等运维接口。
- 本地开发、构建、测试、调试和发版入口。

## 什么不在这里

下面这些内容仍然应该回到设计档案中查看：

- 为什么选择当前路线。
- 阶段性计划和未落地能力清单。
- 历史架构对比与产品演进讨论。

这些信息保存在 `docs/superpowers/` 下。正式开发时，如果设计档案与当前代码冲突，应优先相信源码、包脚本和测试，再回过头更新文档。

## 文档维护触发器

如果你修改了下面这些内容，应该同步检查开发文档：

- 启动命令、构建命令、测试命令或发版入口。
- REST 路由、Socket.IO 事件或认证边界。
- Agent 注册、hostname 绑定、自动建档、local users 上报、心跳和 live session 会话语义。
- 页面导航、用户可见工作流、人员绑定或移动端访问流程。
- 任务调度、安全审计、人员归属和通知行为。

如果变更会影响管理员工作流、节点使用方式或移动端体验，也要同步检查 `docs/user/` 中的对应页面。

当前的 CI 与发版说明已经整理在 [local-development.md](local-development.md) 中，包含 tag 规则、版本源和 GitHub 侧前置配置。