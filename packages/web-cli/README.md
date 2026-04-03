# pmeow-web

`pmeow-web` 是 PMEOW Web 服务端的发行包入口，适合全局安装后直接运行。

## 安装

```bash
npm install -g pmeow-web
```

## 使用

```bash
# 使用默认参数启动（端口 17200）
pmeow-web

# 指定端口
pmeow-web --port 8080

# 指定 SQLite 数据库路径
pmeow-web --db /var/lib/pmeow.db

# 查看帮助
pmeow-web --help

# 查看版本
pmeow-web --version
```

## CLI 参数

| 参数 | 说明 |
|---|---|
| `--port <port>` | 指定监听端口；等价于设置 `PORT` |
| `--db <path>` | 指定 SQLite 数据库路径；等价于设置 `MONITOR_DB_PATH` |
| `--help`, `-h` | 显示帮助信息 |
| `--version`, `-v` | 显示版本号 |

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `17200` | Web 服务监听端口 |
| `MONITOR_DB_PATH` | `./data/monitor.db` | SQLite 数据库路径 |
| `JWT_SECRET` | 随机生成 | JWT 签名密钥；正式部署建议固定设置 |

## 数据路径说明

如果没有显式设置 `MONITOR_DB_PATH`，`pmeow-web` 会把数据库放在当前工作目录下的 `./data/monitor.db`。这意味着你从不同目录启动，数据库的实际落点也会不同。

## 适用场景

- 想把 PMEOW Web 服务端作为全局命令安装后直接运行
- 不准备保留完整仓库，只需要发行包部署方式
- 需要通过 `--port` 或 `--db` 快速覆盖默认启动参数

## 完整文档

完整说明请参考 PMEOW 仓库文档：

- 仓库主页：https://github.com/huan-yp/PMEOW
- 用户文档：`docs/user/`
- 开发文档：`docs/developer/`
