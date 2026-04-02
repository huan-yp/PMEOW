# Monitor — 多服务器硬件监控平台

实验室多服务器硬件监控系统，支持 Electron 桌面端和 Web 服务两种运行模式。

## 功能

- **大屏概览** — 同时监控多台服务器 CPU/内存/磁盘/网络/GPU
- **GPU 钩子系统** — GPU 空闲时自动触发操作（执行命令/HTTP 请求/桌面通知）
- **可视化规则编辑器** — 图形化配置触发条件和动作
- **历史数据** — 趋势图表与数据保留策略
- **告警通知** — CPU/内存/磁盘超阈值告警
- **双模式运行** — Electron 桌面 + Web Server
- **SSH 密钥认证** — 仅支持密钥连接，安全可靠

## 技术栈

| 层 | 技术 |
|---|---|
| 核心 | Node.js, SSH2, better-sqlite3 |
| 前端 | React 18, TypeScript, Tailwind CSS, ECharts, Zustand |
| Web 服务 | Express, Socket.IO, JWT |
| 桌面 | Electron, electron-vite |

## 快速开始

### 环境要求

- Node.js >= 20
- pnpm >= 9

### 安装

```bash
pnpm install
```

### Web 模式开发

```bash
# 终端 1: 启动 Web 后端
pnpm dev:web

# 终端 2: 启动 UI 开发服务器
pnpm dev:ui
```

访问 `http://localhost:5173`。首次打开需设置密码。

### Web 模式生产部署

```bash
pnpm build:web
pnpm start:web
```

### Docker 部署

```bash
docker compose up -d
```

访问 `http://localhost:17200`

### Electron 模式

```bash
pnpm dev:electron
```

## 项目结构

```
packages/
  core/      # 核心库: SSH 连接、数据采集、数据库、钩子引擎
  ui/        # 共享 React UI（Electron/Web 共用）
  web/       # Web 服务模式: Express + Socket.IO
  electron/  # Electron 桌面模式
```

## 配置

通过 Web 界面的「设置」页面配置：

- **数据采集间隔** — 默认 5 秒
- **告警阈值** — CPU/内存/磁盘百分比
- **历史数据保留** — 默认 7 天
- **对外 API** — 可选开启，端口 17210
