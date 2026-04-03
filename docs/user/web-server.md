# Web 服务端部署指南

这份文档面向服务端管理员，重点说明 PMEOW Web 服务的启动方式、持久化位置、认证机制和运维注意事项。

## 你需要准备什么

- Node.js 20+
- pnpm 9+
- 一份可写的数据目录，用于 SQLite 数据库和上传的 SSH 密钥
- 如果要接入 SSH 节点，服务端需要能读取对应私钥文件

## 三种启动方式

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
- 浏览器通常访问 `http://localhost:5129`。

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

生产模式下默认绑定 `0.0.0.0:17200`。本机访问用 `http://localhost:17200`，远端访问改成服务器实际 IP 或域名。

### 发行包模式

如果你不准备保留整个仓库，而是希望把 Web 服务端当作发行包安装，可以直接使用：

```bash
npm install -g pmeow-web
pmeow-web
```

当前 `pmeow-web` 本质上仍然是对 `packages/web` 构建产物的发行封装，因此环境变量、数据库路径和 JWT 行为与本页下面的说明保持一致。

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
| `HOST` | `0.0.0.0` | Web 服务绑定地址 |
| `PORT` | `17200` | Web 服务监听端口 |
| `MONITOR_DB_PATH` | 当前工作目录下 `data/monitor.db` | SQLite 数据库绝对路径 |
| `JWT_SECRET` | 未设置时使用临时随机值 | Web 登录 token 的签名密钥 |

关于 `JWT_SECRET` 需要特别注意：

- 如果你不显式设置它，服务每次重启都会生成新的临时密钥。
- 这会让旧 token 立即失效，浏览器用户需要重新登录。
- 在正式部署中，建议把它固定成稳定值。
- 当前 Web 登录 token 默认有效期为 30 天；只要 token 未过期且 `JWT_SECRET` 未变化，浏览器刷新页面时会优先复用现有登录态。

## 数据与文件会写到哪里

### SQLite 数据库

服务端通过 `MONITOR_DB_PATH` 决定数据库路径：

- 如果设置了 `MONITOR_DB_PATH`，会直接使用该路径，并自动创建父目录。
- 如果没有设置，默认使用当前工作目录下的 `data/monitor.db`。

这里的“当前工作目录”指的是 Web 服务进程自己的 cwd，不一定是你打开终端时看到的仓库根目录。

在当前项目里，如果你直接从仓库根目录运行 `npm run start:web` 或 `pnpm start:web` 这类 workspace 脚本，Web 进程通常会以 `packages/web` 作为 cwd，因此默认数据库通常会出现在：

```text
packages/web/data/monitor.db
```

数据库采用 SQLite，并启用了：

- `WAL` journal mode
- foreign keys

### 上传的 SSH 密钥

Web API 的密钥上传接口会把文件保存到当前工作目录下的 `data/keys/` 目录，并把权限设为 `600`。

这意味着：

- 你的工作目录需要是可写的。
- 如果是 Docker 部署，应该确认该目录是否也需要持久化。
- 如果你不希望通过网页上传密钥，可以直接在服务器文件系统中放置密钥，再在“节点”页面填写绝对路径。

## 首次登录与认证边界

当前认证模型比较简单：

1. `POST /api/login` 是唯一公开登录入口。
2. 如果数据库里还没有密码，这次登录会同时完成密码初始化。
3. 之后所有 `/api/*` 请求都需要 `Bearer token`。
4. 浏览器的 Socket.IO UI 连接也依赖这个 token。

当前默认 token 有效期为 30 天。只要 token 未过期且服务端 `JWT_SECRET` 保持稳定，浏览器按 `Ctrl+R` 刷新页面时不需要重新输入口令。

这个模型适合单实验室、小范围运维场景，但不是多租户权限系统。当前默认只有管理员视角。

## 如何重置 Web 登录密码

先说结论：当前实现没有预置默认密码。系统初次登录时，如果数据库里没有保存密码，第一次提交到登录页的密码就会被写入数据库并成为新的管理员密码。

因此，重置密码最直接的方法不是“找回明文”，而是删除数据库里 `settings` 表中的 `password` 这一行，让系统回到“未初始化密码”的状态。

### 如果你还记得当前密码

最简单的方式是直接登录 Web 控制台，在“设置”页修改密码。

### 如果你已经忘记当前密码

对服务端使用的 SQLite 数据库执行下面这条 SQL：

```sql
DELETE FROM settings WHERE key = 'password';
```

执行完成后：

1. 打开 Web 登录页。
2. 输入你想设置的新密码。
3. 这次登录会被当作新的初始化密码写入数据库。

### 常见数据库位置

- 本地默认部署：`data/monitor.db`
- 使用根目录 workspace 脚本启动 Web 时，通常是 `packages/web/data/monitor.db`
- 显式设置了 `MONITOR_DB_PATH`：以该环境变量指定的绝对路径为准
- Docker 默认部署：容器内 `/data/monitor.db`

### 常见操作示例

如果你在宿主机上能直接访问数据库文件，可以执行：

```bash
sqlite3 data/monitor.db "DELETE FROM settings WHERE key='password';"
```

如果你是自定义数据库路径，可以执行：

```bash
sqlite3 "$MONITOR_DB_PATH" "DELETE FROM settings WHERE key='password';"
```

如果当前机器没有安装 `sqlite3` 命令，但你是在 PMEOW 仓库内操作，也可以直接复用项目依赖里的 `better-sqlite3`：

```bash
pnpm --filter @monitor/core exec node --input-type=module -e "import Database from 'better-sqlite3'; const db = new Database('/absolute/path/to/monitor.db'); db.prepare('DELETE FROM settings WHERE key = ?').run('password'); db.close(); console.log('password reset');"
```

例如本地默认部署可以写成：

```bash
pnpm --filter @monitor/core exec node --input-type=module -e "import Database from 'better-sqlite3'; const db = new Database('data/monitor.db'); db.prepare('DELETE FROM settings WHERE key = ?').run('password'); db.close(); console.log('password reset');"
```

如果你是按 README 中的根目录 workspace 脚本方式启动 Web，更稳妥的写法通常是：

```bash
pnpm --filter @monitor/core exec node --input-type=module -e "import Database from 'better-sqlite3'; const db = new Database('packages/web/data/monitor.db'); db.prepare('DELETE FROM settings WHERE key = ?').run('password'); db.close(); console.log('password reset');"
```

如果你使用的是 Docker 部署，但不方便在容器内使用 `sqlite3`，也可以使用任意 SQLite 工具直接对容器内的 `/data/monitor.db` 执行上面的 SQL，或者在容器内运行同样的 Node 命令。

### 一个重要边界

删除或重置密码只会影响后续登录，不会自动让已经签发出去的 JWT 立即失效。

如果你希望强制所有已登录浏览器马上重新登录，应该同时轮换 `JWT_SECRET` 并重启服务端。否则旧 token 在过期前仍然可能继续可用。

## 服务端部署后的推荐检查项

第一次部署完成后，建议按下面顺序检查：

1. 访问 Web 页面，确认静态资源能正常加载。
2. 完成首次登录，确认页面没有立即回到登录态，并测试浏览器按 `Ctrl+R` 刷新后无需重复输入口令。
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