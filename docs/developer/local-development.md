# 本地开发指南

这份文档描述当前仓库最直接、最稳定的开发方式，默认使用 `pnpm` 管理 TypeScript Monorepo，使用 Python 虚拟环境管理 Agent。

## 前置条件

建议至少准备下面这些工具：

- Node.js 20+
- pnpm 9+
- Python 3.10+
- Linux，用于实际运行 Agent 采集与 daemon（依赖 `/proc` 和 Unix socket）
- 可选：Docker 和 docker compose，用于验证打包与部署路径
- 可选：Android Studio 和 JDK，用于调试 Capacitor Android 打包

## 仓库初始化

### TypeScript Monorepo 初始化

在仓库根目录执行：

```bash
pnpm install
```

这会安装 `packages/core`、`packages/ui`、`packages/web` 和 `packages/web-cli` 所需依赖。

### Python Agent 初始化

Agent 不在 pnpm workspace 内，需要单独初始化：

```bash
cd agent
python3 -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
```

如果你在 PowerShell 下工作，可以改用：

```powershell
Set-Location agent
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
```

## 推荐的本地运行布局

### 只调 Web 和 UI

```bash
# 终端 1
pnpm dev:web

# 终端 2
pnpm dev:ui
```

说明：

- `pnpm dev:web` 会先构建 `core`，再在 `packages/web` 下用 `tsx watch` 运行服务端。
- `pnpm dev:ui` 会先构建 `core`，再启动 Vite 开发服务器。
- `packages/ui` 的 Vite 开发服务器固定监听 `0.0.0.0:5129`，并把 `/api` 与 `/socket.io` 代理到 `http://localhost:17200`。
- 浏览器入口通常是 `http://localhost:5129`。

### 运行接近生产的 Web 实例

```bash
pnpm build:web
pnpm start:web
```

这个路径适合验证：

- 构建产物是否完整
- `packages/web/dist/public` 是否正确包含 UI 静态资源
- 不依赖 Vite 的纯服务端部署链路是否正常

### 单独开发 Agent

```bash
cd agent
. .venv/bin/activate
pmeow-agent run

# 后台模式
PMEOW_AGENT_LOG_FILE=$PWD/.tmp/agent.log pmeow-agent start
pmeow-agent is-running
pmeow-agent stop
```

如果你同时跑多个本地 Agent 实例，除了拆分 `PMEOW_STATE_DIR` 和 `PMEOW_SOCKET_PATH`，也要拆分 `PMEOW_PID_FILE` 和 `PMEOW_AGENT_LOG_FILE`。

如果你只想跑 Agent 测试而不连接真实服务端，可以保持 `PMEOW_SERVER_URL` 为空，专注于本地 socket、队列和采集层测试。

### 调试移动端或构建 Android 包

```bash
pnpm build:apk
pnpm --filter @monitor/ui apk:debug
```

如果你在 Windows 上直接跑 Gradle，等价命令通常是：

```powershell
pnpm build:apk
Set-Location packages/ui/android
.\gradlew.bat assembleDebug
```

如果你需要继续打开 Android 工程：

```bash
pnpm --filter @monitor/ui cap:open
```

`pnpm build:apk` 会先构建 `core`，再在 UI 包内执行 Vite 构建和 Capacitor sync。

## 常用命令速查

### 根级命令

```bash
pnpm dev:web
pnpm dev:ui
pnpm build:core
pnpm build:web
pnpm build:web-cli
pnpm start:web
pnpm test:core
pnpm test:web
pnpm typecheck:core
pnpm typecheck:web
pnpm build:apk
```

### 包级命令

如果你只想针对某个 package 工作，也可以进入对应目录执行包级脚本：

- `packages/core`: `build`, `dev`, `test`, `test:watch`, `typecheck`
- `packages/web`: `dev`, `build`, `start`, `test`, `test:watch`, `typecheck`
- `packages/ui`: `dev`, `build`, `test`, `typecheck`, `cap:sync`, `cap:build`, `cap:open`, `apk:debug`
- `packages/web-cli`: `build`

### Agent 命令

```bash
cd agent
. .venv/bin/activate
pytest -v

# 交互验证 CLI
pmeow-agent status
pmeow-agent submit --pvram 4000 --gpu 1 -- python train.py
```

如果你想验证 Python 直达模式，也可以直接试：

```bash
cd agent
. .venv/bin/activate
pmeow -vram=8g -gpus=1 --report examples/tasks/pytorch_hold.py --gpus 1 --mem-per-gpu 7g --seconds 30
```

## 本地环境变量

### Web 服务端

开发时最常见的是：

- `HOST`
- `PORT`
- `MONITOR_DB_PATH`
- `JWT_SECRET`

建议：

- 需要让 Web 服务只绑定某个接口时，显式设置 `HOST`
- 需要隔离数据库时，为当前 shell 显式设置 `MONITOR_DB_PATH`
- 需要跨重启保留登录态时，为当前 shell 显式设置 `JWT_SECRET`

### Agent

开发 Agent 时最常见的是：

- `PMEOW_SERVER_URL`
- `PMEOW_AGENT_ID`
- `PMEOW_STATE_DIR`
- `PMEOW_SOCKET_PATH`
- `PMEOW_LOG_DIR`
- `PMEOW_PID_FILE`
- `PMEOW_AGENT_LOG_FILE`

如果你同时跑多个本地 Agent 实例，一定要给它们分配不同的状态目录、socket 路径、pid 文件和运行日志 `runtime log` 文件，否则很容易互相污染。

如果没有设置 `PMEOW_SERVER_URL`，Agent 会以 local-only 模式运行。这样可以调试本地队列、daemon 和 CLI，但不会向 Web 服务注册，也不会接收远程控制命令。

## 本地数据位置

### Web 服务端

默认情况下，服务端会把 SQLite 放在当前工作目录下：

```text
data/monitor.db
```

上传的 SSH 密钥默认放在：

```text
data/keys/
```

这两个路径都相对于当前启动 Web 进程时的 `process.cwd()`；如果你从不同目录启动 `pnpm start:web` 或 `pmeow-web`，落点会随之变化。

### Agent

默认情况下，Agent 会把本地状态放在：

```text
~/.pmeow/
```

其中包括本地 SQLite、Unix socket 和任务日志。

## 几种典型开发路径

### 改桌面 UI 或移动端 UI

优先运行：

- `pnpm dev:ui`
- `pnpm dev:web`
- `pnpm --filter @monitor/ui test`

如果改动涉及移动端连接流程，再补跑 Android 构建链路。

### 改 REST API 或服务端行为

优先运行：

- `pnpm dev:web`
- `pnpm test:web`
- `pnpm typecheck:web`

如果改动涉及共享模型或核心逻辑，还需要补跑 `pnpm test:core`。如果改动影响静态资源拷贝、打包入口或 `packages/web/dist/public`，再补跑一次 `pnpm build:web`。

### 改共享模型或调度器

优先运行：

- `pnpm test:core`
- `pnpm typecheck:core`
- `pnpm test:web`

因为 `core` 改动很容易影响 Web 侧路由、UI 传输层和移动端数据读取。

### 改 Agent

优先运行：

- `pytest -v`
- 本地 `pmeow-agent run`
- 如果涉及协议变化，再联调一份 Web 服务

如果改动的是提交语义、附着式 Python 或 daemon 环境快照，额外关注 `agent/tests/test_cli_runtime.py`、`agent/tests/test_cli_python.py` 和 `agent/tests/store/test_tasks.py`。

## CI 与发版

当前仓库已经内置了 GitHub Actions 的校验和发版流程，维护时主要看下面四个文件：

- `.github/workflows/ci.yml`：PR 和 push 的通用校验
- `.github/workflows/release-agent.yml`：PyPI 发版
- `.github/workflows/release-web.yml`：npm 发版
- `.github/workflows/release-docker.yml`：Web 服务 Docker 镜像发版

### 版本源与 tag 规则

- Python Agent 的版本源是 `agent/pyproject.toml`
- npm Web 发行包的版本源是 `packages/web-cli/package.json`
- Agent 发版 tag 形如 `agent-v0.1.0`
- Web 发版 tag 形如 `web-v1.0.0`

CI 会强校验 tag 和包内版本是否一致；不一致时会直接失败，不会继续发布。

### 本地发版前最小检查

发布前至少建议在本地跑通下面几步：

```bash
pnpm test:core
pnpm test:web
pnpm --filter @monitor/ui test
pnpm build:web-cli

cd agent
. .venv/bin/activate
pytest -v
```

其中 `pnpm build:web-cli` 会先构建 `core`、`ui`、`web`，再构建最终对外发布的 `pmeow-web` 包。

## 开发时的几个稳定做法

1. 不要把 Agent 开发和 Web 开发混在一个共享状态目录里，隔离路径更省事。
2. 改协议时同时更新 Web 端、Agent 端和文档，不要只改单边。
3. 需要验证登录态时优先固定 `JWT_SECRET`，否则重启后容易误判为前端问题。
4. 需要验证接近生产的资源链路时，用 `pnpm build:web && pnpm start:web` 补跑一遍，不要只看开发服务器是否正常。

## 移动端本地开发

移动端路由在 Vite 开发服务器中直接可用，无需额外配置。

### 管理员移动端

1. 在桌面端正常登录获取 JWT。
2. 在浏览器中打开 `/m/admin`。
3. 使用 Chrome DevTools 的设备模拟模式查看移动端布局。

### 个人移动端

1. 先在桌面端人员详情页创建一个个人移动端 Token。
2. 在浏览器中打开 `/m/me`。
3. 在令牌输入框填入 `pmt_...` 令牌。

### 相关测试

移动端 UI 测试：

```bash
pnpm --filter @monitor/ui exec vitest run tests/mobile-admin-pages.test.tsx tests/mobile-person-pages.test.tsx
```

移动端接口测试：

```bash
pnpm --filter @monitor/web exec vitest run tests/mobile-admin-routes.test.ts tests/mobile-person-routes.test.ts
```

## 构建 Android APK

PMEOW 使用 Capacitor 将移动端 Web UI 打包为 Android APK。

### 环境准备

- **Android SDK** — 安装 Android Studio 或仅安装命令行工具，确保 `ANDROID_HOME` 或 `ANDROID_SDK_ROOT` 环境变量已设置
- **JDK 17+** — Gradle 构建需要 Java
- **Node.js 20+** 和 **pnpm 9+** — 与 Web 开发相同

### 构建命令

一键构建 debug APK：

```bash
pnpm build:apk
```

这等价于：

```bash
pnpm build:core
cd packages/ui
pnpm build          # Vite 构建 UI
pnpm cap:sync       # 同步 Web 资源到 android/
pnpm apk:debug      # Gradle 构建 debug APK
```

生成的 APK 位于：

```text
packages/ui/android/app/build/outputs/apk/debug/app-debug.apk
```

### 在 Android Studio 中打开

```bash
cd packages/ui && pnpm cap:open
```

### 调试

1. 在 Android 设备上启用开发者模式和 USB 调试。
2. 连接设备后通过 Android Studio 运行应用。
3. 在 Chrome 浏览器中打开 `chrome://inspect` 可以远程调试 WebView。

### Capacitor 配置

Capacitor 配置文件位于 `packages/ui/capacitor.config.ts`，主要配置：

- `appId`: `dev.pmeow.app`
- `webDir`: `dist` — Vite 构建产物目录
- `server.androidScheme`: `https` — WebView 使用 HTTPS scheme
- `server.allowNavigation`: `['*']` — 允许向任意服务器发请求
- `android.allowMixedContent`: `true` — 兼容 HTTP 服务器

### 相关脚本

| 脚本 | 位置 | 说明 |
| --- | --- | --- |
| `pnpm build:apk` | 根目录 | 一键构建 debug APK |
| `pnpm cap:sync` | packages/ui | 同步 web 资源到 Android 项目 |
| `pnpm cap:build` | packages/ui | 构建 UI + 同步 |
| `pnpm cap:open` | packages/ui | 打开 Android Studio |
| `pnpm apk:debug` | packages/ui | Gradle 构建 debug APK |