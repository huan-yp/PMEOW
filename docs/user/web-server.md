# Web 服务端部署指南

这份文档面向服务端管理员，重点说明 PMEOW Web 服务的启动方式、持久化位置、认证机制和运维注意事项。

## 你需要准备什么

- Node.js 20+
- pnpm 9+
- 一份可写的数据目录，用于 SQLite 数据库和上传的 SSH 密钥
- 如果要接入 SSH 节点，服务端需要能读取对应私钥文件

## 两种启动方式

### 开发模式

适合调试 UI、API 或验证部署前配置。

```bash
pnpm install

# 终端 1
pnpm dev:web

# 终端 2
pnpm dev:ui
```

特点：

- `packages/web/src/server.ts` 通过 `tsx watch` 启动后端。
- `packages/ui` 由 Vite 提供开发服务器。
- 浏览器通常访问 `http://localhost:5173`。

### 生产模式

适合本地长期运行或做 systemd/docker 封装。

```bash
pnpm install
pnpm build:web
pnpm start:web
```

其中 `pnpm build:web` 会按顺序完成：

1. 构建 `packages/core`
2. 构建 `packages/ui`
3. 构建 `packages/web` 并把 UI 产物复制到 `packages/web/dist/public`

生产模式下默认监听 `17200`，直接访问 `http://localhost:17200`。

### Docker 模式

仓库已经提供了完整镜像和 Compose 文件：

```bash
docker compose up -d
```

默认 Compose 行为：

- 端口映射为 `17200:17200`
- 持久化卷挂载到容器内 `/data`
- 数据库默认路径为 `/data/monitor.db`
- 宿主机 `~/.ssh` 以只读方式挂载到容器内 `/root/.ssh`

如果你的节点是 SSH 模式，这个只读挂载很重要，因为服务端需要用这些私钥去连接远端主机。

## 服务端环境变量

当前 Web 服务端的关键环境变量很少，核心是下面三个：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `17200` | Web 服务监听端口 |
| `MONITOR_DB_PATH` | 当前工作目录下 `data/monitor.db` | SQLite 数据库绝对路径 |
| `JWT_SECRET` | 未设置时使用临时随机值 | Web 登录 token 的签名密钥 |

关于 `JWT_SECRET` 需要特别注意：

- 如果你不显式设置它，服务每次重启都会生成新的临时密钥。
- 这会让旧 token 立即失效，浏览器用户需要重新登录。
- 在正式部署中，建议把它固定成稳定值。

## 数据与文件会写到哪里

### SQLite 数据库

服务端通过 `MONITOR_DB_PATH` 决定数据库路径：

- 如果设置了 `MONITOR_DB_PATH`，会直接使用该路径，并自动创建父目录。
- 如果没有设置，默认使用当前工作目录下的 `data/monitor.db`。

数据库采用 SQLite，并启用了：

- `WAL` journal mode
- foreign keys

### 上传的 SSH 密钥

Web API 的密钥上传接口会把文件保存到当前工作目录下的 `data/keys/` 目录，并把权限设为 `600`。

这意味着：

- 你的工作目录需要是可写的。
- 如果是 Docker 部署，应该确认该目录是否也需要持久化。
- 如果你不希望通过网页上传密钥，可以直接在服务器文件系统中放置密钥，再在“服务器管理”页面填写绝对路径。

## 首次登录与认证边界

当前认证模型比较简单：

1. `POST /api/login` 是唯一公开登录入口。
2. 如果数据库里还没有密码，这次登录会同时完成密码初始化。
3. 之后所有 `/api/*` 请求都需要 `Bearer token`。
4. 浏览器的 Socket.IO UI 连接也依赖这个 token。

这个模型适合单实验室、小范围运维场景，但不是多租户权限系统。当前默认只有管理员视角。

## 服务端部署后的推荐检查项

第一次部署完成后，建议按下面顺序检查：

1. 访问 Web 页面，确认静态资源能正常加载。
2. 完成首次登录，确认页面没有立即回到登录态。
3. 检查数据库文件是否已经生成。
4. 新增一台 SSH 节点并执行“测试连接”。
5. 如果有 Agent 节点，确认 `/agent` namespace 建立连接后可以自动绑定。

## 什么时候应该重启服务

下列场景建议重启服务端：

- 修改了 `PORT`、`MONITOR_DB_PATH` 或 `JWT_SECRET`
- 升级了二进制/镜像版本
- 数据库目录权限发生变化

而普通设置项，例如刷新间隔、告警阈值和安全审计参数，当前通过设置页保存后会触发服务端内部重启调度器，不需要整站重启。

## 备份建议

最小备份集合建议包含：

- SQLite 数据库文件
- 你实际使用的 SSH 私钥目录
- 部署时使用的环境变量或 systemd/Compose 配置

如果你还运行了 Agent，节点本地的 `~/.pmeow/` 目录也应纳入备份策略。详细说明见 [agent-nodes.md](agent-nodes.md)。