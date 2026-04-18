# PMEOW 文档中心

这套正式文档只描述当前 main 上已经落地的行为。设计背景、阶段性方案和未落地能力仍保存在 `docs/superpowers/` 中。

## 按目标开始

- 我想先把系统跑起来：[user/getting-started.md](user/getting-started.md)
- 我想部署或迁移 Web 服务端：[user/web-server.md](user/web-server.md)
- 我想接入第一台 SSH 或 Agent 节点：[user/agent-nodes.md](user/agent-nodes.md)
- 我想理解桌面控制台页面和入口：[user/web-console.md](user/web-console.md)
- 我想管理人员归属、绑定关系和移动端令牌：[user/people-and-access.md](user/people-and-access.md)
- 我想使用管理员或个人移动端：[user/mobile-app.md](user/mobile-app.md)
- 我想排查运行问题：[user/troubleshooting.md](user/troubleshooting.md)
- 我想修改代码或对齐协议：[developer/README.md](developer/README.md)
- 我想看设计背景和实施档案：`docs/superpowers/`

## 文档分层

- 顶层 [../README.md](../README.md) 只负责项目定位、已落地能力摘要、最短启动路径和文档导航。
- [user/README.md](user/README.md) 面向管理员、运维和值班同学，重点回答“怎么部署、怎么接入、怎么用”。
- [developer/README.md](developer/README.md) 面向贡献者和维护者，重点回答“系统怎么工作、如何本地开发、协议和测试如何对齐”。
- `docs/superpowers/` 是设计与规划档案，不是当前操作手册。

## 用户文档

- [user/README.md](user/README.md) - 用户文档入口与阅读顺序
- [user/getting-started.md](user/getting-started.md) - 5 到 10 分钟完成第一次试跑
- [user/web-server.md](user/web-server.md) - Web 服务端部署、持久化与认证说明
- [user/agent-nodes.md](user/agent-nodes.md) - Agent 节点安装、配置、systemd 和 CLI 工作流
- [user/web-console.md](user/web-console.md) - Web 控制台页面地图与使用边界
- [user/people-and-access.md](user/people-and-access.md) - 人员目录、绑定关系与移动端访问
- [user/mobile-app.md](user/mobile-app.md) - 管理员与个人移动端入口
- [user/troubleshooting.md](user/troubleshooting.md) - 常见问题、排障路径与运维提示

## 开发文档

- [developer/README.md](developer/README.md) - 开发文档入口与阅读建议
- [developer/Web 模块架构.md](developer/Web%20%E6%A8%A1%E5%9D%97%E6%9E%B6%E6%9E%84.md) - Web 模块边界和页面装配
- [developer/Web 数据摄入链路.md](developer/Web%20%E6%95%B0%E6%8D%AE%E6%91%84%E5%85%A5%E9%93%BE%E8%B7%AF.md) - Web 数据获取与实时消费链路
- [developer/UI 模块架构.md](developer/UI%20%E6%A8%A1%E5%9D%97%E6%9E%B6%E6%9E%84.md) - UI 共享层与组件组织
- [developer/Agent 模块架构.md](developer/Agent%20%E6%A8%A1%E5%9D%97%E6%9E%B6%E6%9E%84.md) - Agent 模块结构与运行方式
- [developer/任务事件模型.md](developer/%E4%BB%BB%E5%8A%A1%E4%BA%8B%E4%BB%B6%E6%A8%A1%E5%9E%8B.md) - 任务事件定义与状态流转
- [developer/告警事件处理.md](developer/%E5%91%8A%E8%AD%A6%E4%BA%8B%E4%BB%B6%E5%A4%84%E7%90%86.md) - 告警与安全事件处理边界

## 如果文档和代码冲突

应优先相信当前源码、包脚本和测试，再回过头更新文档。正式文档和规划档案看起来不一致时，也应以当前已落地实现为准。