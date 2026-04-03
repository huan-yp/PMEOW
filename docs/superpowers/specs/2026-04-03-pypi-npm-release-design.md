# PMEOW 发布 CI 设计文档 — PyPI 与 npm 自动发布

日期：2026-04-03

## 1. 背景与目标

当前仓库已经具备两类可交付产物的基础：

- Python Agent 已经是一个独立的 Python 项目，包名为 `pmeow-agent`
- Web 服务已经具备稳定的构建链路，但仍停留在 Monorepo 内部源码运行阶段

当前缺口主要有三项：

- 仓库没有 GitHub Actions，发布完全依赖人工
- npm 侧现有 package 都是 `private: true`，不能直接对外安装
- README 和用户文档仍以源码仓库启动为主，不满足“安装即用”

本设计的目标是把交付体验收敛为两条正式发布路径：

- `pip install pmeow-agent` 后可直接使用 Agent CLI
- `npm install -g pmeow-web` 后可直接启动 PMEOW Web 服务

同时保留 Docker 作为并行部署路径，但 Docker 不替代 npm 发布，也不阻塞 npm 发布。

## 2. 现状结论

基于当前仓库结构与配置，发布设计需要建立在以下事实之上：

- `agent/pyproject.toml` 已定义 `pmeow-agent`，版本独立维护
- 根目录和 `packages/core`、`packages/web`、`packages/ui` 当前都仍是 `private`
- `packages/web` 运行时依赖 `@monitor/core` 的 workspace/file 依赖，不适合直接拿去做公开 npm 包
- `packages/web` 的构建会把 `packages/ui/dist` 复制到 `packages/web/dist/public`
- 仓库目前没有 `.github/workflows`，也没有 `changesets`、`release-please`、`semantic-release` 等发布框架
- 最近提交已经为 npm workspace 兼容和 dist 入口做了铺垫，说明当前结构适合在此基础上补一个发行层，而不是推翻现有构建方式

## 3. 关键决策

| 决策项 | 结论 | 理由 |
|--------|------|------|
| PyPI 发布物 | 继续发布 `pmeow-agent` | 已有独立项目边界，改动最小 |
| npm 发布物 | 新增独立发行包 `packages/web-cli`，发布名定为 `pmeow-web` | 避免把内部 workspace 结构直接暴露给最终用户 |
| npm CLI 名称 | `pmeow-web` | 与包名一致，降低安装与文档理解成本 |
| 版本策略 | PyPI 与 npm 独立版本 | Agent 与 Web 变更节奏不同，不应相互绑定 |
| 正式发布触发 | 打 tag 发布 | 避免 main 分支合并即误发正式版 |
| tag 规范 | `agent-vX.Y.Z` 与 `web-vX.Y.Z` | 一眼区分发布目标，并便于 workflow 分流 |
| Docker 路径 | 保留并行维护，不与 npm 发布耦合 | 满足服务端部署场景，同时不影响“安装即用”目标 |
| npm 运行时策略 | 发行包内聚合 Web 服务运行时与静态资源，不要求用户保留 Monorepo | 用户安装后应直接可运行，而不是依赖源码仓库结构 |
| 发布鉴权 | PyPI 优先 Trusted Publisher，npm 使用 automation token | 减少长期密钥暴露面，符合平台最佳实践 |

## 4. 发布边界与包模型

### 4.1 Python 侧

Python 侧保持当前模型：

- 发布目录仍为 `agent/`
- 版本源仍为 `agent/pyproject.toml`
- CLI 入口仍为 `pmeow-agent` 与 `pmeow`

发布设计不改变 Agent 的运行模型、配置模型和 systemd 部署方式，只补自动化构建、校验和发布。

### 4.2 npm 侧

npm 侧新增一个面向用户安装的发行包：

- 目录：`packages/web-cli`
- 包名：`pmeow-web`
- CLI：`pmeow-web`

这个包不是新的业务层，而是一个稳定的发行壳层，职责只有四项：

- 提供全局安装后的 CLI 入口
- 聚合当前 Web 服务运行时所需代码
- 携带 UI 静态资源
- 暴露最终用户需要的运行时依赖与启动方式

它不承担业务逻辑开发，不替代现有 `packages/web`、`packages/core`、`packages/ui`，也不改变这些包在 Monorepo 内部的职责。

### 4.3 npm 发行包的运行时边界

为了避免公开发布 `@monitor/core` 这种当前仍面向内部的 workspace 包，`pmeow-web` 发行包采用“聚合运行时”的方式：

- 复用现有 `packages/core` 与 `packages/web` 的编译输出或源码入口进行发行构建
- 发行产物内包含 Web 服务运行所需代码，不要求最终用户再安装 `@monitor/core`
- UI 静态资源在发行构建时直接带入发布包

这意味着最终用户面对的是一个可执行 npm 包，而不是一个依赖 Monorepo 结构拼装起来的半成品。

## 5. CI 与发布流水线设计

### 5.1 通用 CI

仓库新增一条通用 CI，用于所有 PR 和普通 push，只做验证，不做发布。

校验内容：

- Node 20 环境安装与缓存恢复
- `pnpm` 依赖安装
- `build:core`
- `build:web`
- `test:core`
- `test:web`
- `typecheck:core`
- `typecheck:web`
- Python Agent 的依赖安装与 `pytest`

这条 CI 的作用是把“能不能发”前置到代码合并之前，而不是等到 tag 发布时才第一次发现问题。

### 5.2 PyPI 发布流

PyPI 发布流由 `agent-vX.Y.Z` tag 触发，只处理 Agent。

步骤：

1. 检出代码并准备 Python 环境
2. 读取 tag 中的版本号，与 `agent/pyproject.toml` 对比
3. 版本不一致则直接失败
4. 在 `agent/` 下构建 sdist 与 wheel
5. 在干净环境中做一次最小安装检查
6. 验证 `pmeow-agent --help` 可执行
7. 通过后发布到 PyPI

这条发布流不依赖 npm 侧是否可发布，也不等待 Docker。

### 5.3 npm 发布流

npm 发布流由 `web-vX.Y.Z` tag 触发，只处理 `pmeow-web`。

步骤：

1. 检出代码并准备 Node 20 + `pnpm`
2. 读取 tag 中的版本号，与 `packages/web-cli/package.json` 对比
3. 版本不一致则直接失败
4. 构建 `packages/core`、`packages/ui`、`packages/web` 与 `packages/web-cli`
5. 产出 npm tarball
6. 在干净目录里做一次 tarball 安装验证
7. 验证 `pmeow-web --help` 可执行
8. 做一次最小启动冒烟校验，确认服务端可在临时数据目录中启动
9. 通过后发布到 npm

这条流水线的核心不是“打出 tarball”，而是保证用户全局安装后真的能跑起来。

### 5.4 Docker 发布流

Docker 保留，但与 npm 发布解耦。

方式：

- 单独建立 `web-vX.Y.Z` tag 触发的 Docker 发布流
- 独立构建并推送镜像到目标 registry
- 失败不影响 PyPI 发布
- 失败不回滚已成功的 npm 发布

这样可以同时满足两类用户：

- 需要 `npm install -g pmeow-web` 的轻量部署用户
- 需要镜像化部署的服务端用户

## 6. 版本管理与发布规则

本阶段采用手动版本管理，不引入自动 bump 工具。

规则如下：

- Agent 版本只在 `agent/pyproject.toml` 维护
- Web 版本只在 `packages/web-cli/package.json` 维护
- 发布人先修改版本，再创建对应 tag
- tag 与版本号必须完全一致
- 任一发布流发现 tag 与文件内版本不一致时必须失败

本阶段不引入 `changesets`、自动 changelog 或 merge-to-main 自动发版，原因是：

- 当前仓库还处在快速演进期
- 发布目标只有两个，手动控版本的复杂度可接受
- 手动打 tag 可以显著降低误发正式版的概率

## 7. 凭据、安全与人工前置动作

### 7.1 PyPI

PyPI 侧采用 Trusted Publisher。

需要人工完成：

- 在 PyPI 为 `pmeow-agent` 配置 Trusted Publisher
- 绑定当前 GitHub 仓库、目标 workflow 和发布环境
- 首次验证 OIDC 发布权限是否生效

### 7.2 npm

npm 侧采用单独的 automation token。

需要人工完成：

- 在 npm 确认 `pmeow-web` 包名可用
- 创建用于自动发布的 token
- 将 token 写入 GitHub Actions secrets
- 根据需要开启 npm 包访问控制与发布保护

### 7.3 GitHub 仓库侧

需要人工完成：

- 创建用于正式发布的 GitHub Environment（例如 `release`）
- 为正式发布 workflow 配置最小权限
- 视需要为发布环境增加审批或受保护分支策略
- 如果发布 Docker，再配置对应 registry 凭据

## 8. 失败处理与回滚策略

发布策略遵循“先校验、后发布；发布后优先补发，不依赖删除”的原则。

具体规则：

- 任一发布流在版本校验、构建、测试或冒烟校验失败时，都不得执行 publish
- npm 发布后发现缺陷，默认做修复版重新发布；必要时对问题版本执行 deprecate
- PyPI 发布后发现缺陷，默认做修复版重新发布；仅在紧急情况下考虑 yank，常规路径仍是补发新版本
- Docker 镜像问题通过补发镜像修复，不要求与 npm 包回滚保持严格同步

这样可以避免为了回滚一个发布物而人为破坏另一个已经成功的发布物。

## 9. 文档与用户路径要求

“安装即用”不仅是 CI 任务，也必须在文档层体现。

发布完成后，文档应满足以下要求：

- 根 README 提供正式安装命令，不再只写源码仓库启动方式
- `agent/README.md` 提供 PyPI 安装路径
- 用户文档提供 `pmeow-web` 的全局安装、启动、环境变量和数据目录说明
- Docker 文档继续保留，明确其与 npm 安装路径是并列关系

## 10. 验收标准

当以下条件全部满足时，本设计视为落地成功：

### 10.1 PyPI 侧

- 发布 `agent-vX.Y.Z` tag 后可自动构建并发布 `pmeow-agent`
- 干净环境可执行 `pip install pmeow-agent`
- 安装后 `pmeow-agent --help` 与 `pmeow --help` 可直接运行

### 10.2 npm 侧

- 发布 `web-vX.Y.Z` tag 后可自动构建并发布 `pmeow-web`
- 干净环境可执行 `npm install -g pmeow-web`
- 安装后 `pmeow-web --help` 可直接运行
- 安装后可用临时数据目录完成一次最小启动

### 10.3 仓库侧

- PR 上有统一 CI 兜底
- PyPI、npm、Docker 三条发布路径互不阻塞
- README 和用户文档已经反映正式安装路径

## 11. 非目标

以下内容不在本次发布 CI 设计范围内：

- 把 `packages/core` 做成对外宣传的公共库
- 发布独立的 `packages/ui` 包
- 引入 prerelease 渠道（如 alpha、beta、rc）
- 引入自动版本计算工具
- 把 Docker 作为唯一正式交付方式

## 12. 后续实现范围提示

本设计落地时，预计会涉及以下类别的变更：

- 新增 `.github/workflows/ci.yml`
- 新增 `.github/workflows/release-agent.yml`
- 新增 `.github/workflows/release-web.yml`
- 新增 `.github/workflows/release-docker.yml`
- 新增 `packages/web-cli/` 发行包
- 更新根 README、`agent/README.md` 与用户安装文档

这些内容应在下一步实现计划中拆分，而不是在当前设计阶段直接编码。