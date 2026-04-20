# Agent 节点接入指南

这份文档面向计算节点管理员和节点使用者，解释如何安装 `pmeow-agent`、如何把节点绑定到 Web 服务、以及如何使用本地 CLI 进行任务管理。

## Agent 负责什么

Agent 运行在计算节点本地，负责：

- 采集 CPU、内存、磁盘、网络和 GPU 指标
- 建立 GPU 归属视图
- 维护本地任务队列
- 在满足资源条件时自主调度任务
- 把指标、任务状态和心跳推送给 Web 服务端

服务端不会代替 Agent 做排队调度。服务端能做的是查看、取消、暂停、恢复和调整优先级。

## 安装前置条件

- Python 3.10+
- Linux 计算节点
- 如果需要 GPU 指标，主机上要有 `nvidia-smi`
- 目标节点能访问 PMEOW Web 服务端

## 安装方式

### 从 PyPI 安装

```bash
pip install pmeow-agent
```

### 推荐的系统级安装（独立虚拟环境）

如果节点上会有多个项目虚拟环境，推荐给 Agent 单独准备一套系统级虚拟环境，而不是把它装进某个训练项目自己的 venv：

```bash
sudo mkdir -p /opt/pmeow-agent
sudo python3 -m venv /opt/pmeow-agent/.venv
sudo /opt/pmeow-agent/.venv/bin/pip install --upgrade pip
sudo /opt/pmeow-agent/.venv/bin/pip install pmeow-agent
sudo ln -sf /opt/pmeow-agent/.venv/bin/pmeow-agent /usr/local/bin/pmeow-agent
sudo ln -sf /opt/pmeow-agent/.venv/bin/pmeow /usr/local/bin/pmeow
```

这套方式的目标是把 Agent 自己的运行时固定下来，同时允许用户在别的虚拟环境里继续使用 `pmeow` 提交任务。当前 CLI 在提交 Python 任务时会优先选用调用侧已激活环境的解释器，而不是 Agent 安装所在的解释器。

如果某个项目 venv 里恰好也安装了一份 `pmeow-agent`，那激活后 shell 会优先命中项目内的命令；需要强制使用系统级安装时，请显式调用 `/usr/local/bin/pmeow` 或 `/usr/local/bin/pmeow-agent`。

### 从源码安装

```bash
cd agent
python3 -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
```

如果你只打算运行 Agent 而不是开发它，也可以把源码放到固定目录后再用虚拟环境安装。

安装完成后，可以先确认 CLI 版本：

```bash
pmeow --version
```

## 关键环境变量

Agent 通过环境变量配置，未设置时会使用默认值。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PMEOW_SERVER_URL` | 空 | Web 服务基础地址，例如 `http://server:17200` |
| `PMEOW_AGENT_ID` | 当前 hostname | Agent 唯一标识 |
| `PMEOW_COLLECTION_INTERVAL` | `5` | 指标采集周期，单位秒 |
| `PMEOW_HEARTBEAT_INTERVAL` | `30` | 心跳间隔，单位秒 |
| `PMEOW_HISTORY_WINDOW` | `5` | 调度时参考的历史窗口，单位秒 |
| `PMEOW_VRAM_REDUNDANCY` | `0.1` | 非 PMEOW 进程显存冗余系数 |
| `PMEOW_STATE_DIR` | `~/.pmeow/` | 本地状态目录 |
| `PMEOW_SOCKET_PATH` | `~/.pmeow/pmeow.sock` | CLI 与 daemon 通信的 Unix socket |
| `PMEOW_LOG_DIR` | `~/.pmeow/logs/` | 任务日志目录 |
| `PMEOW_LOG_LEVEL` | `INFO` | Agent runtime log 级别，可设为 `DEBUG` |
| `PMEOW_PID_FILE` | `~/.pmeow/pmeow-agent.pid` | 后台模式 pid 文件 |
| `PMEOW_AGENT_LOG_FILE` | 空 | 后台模式 runtime log 文件 |
| `PMEOW_SOCKET_GROUP` | 空 | systemd 模式下 socket 文件的 Unix group，为空则 chmod 0666 |

关于 `PMEOW_SERVER_URL` 有两个重要约束：

- 传入的是服务端基础 URL，不要自己拼 `/agent`。
- 传入 `http://` 或 `https://` 地址即可，不需要手写原始 WebSocket 地址。

## 三种启动方式

### 前台

```bash
export PMEOW_SERVER_URL=http://your-server:17200
pmeow-agent run
```

当前 `pmeow-agent daemon` 仍然是兼容别名，但更推荐写成 `pmeow-agent run`。前台方式适合初次接入和现场排障，runtime log 直接看当前终端。

### 后台

```bash
export PMEOW_SERVER_URL=http://your-server:17200
export PMEOW_AGENT_LOG_FILE=~/.pmeow/agent.log
export PMEOW_LOG_LEVEL=DEBUG
pmeow-agent start
pmeow-agent is-running
pmeow-agent stop
```

适合不想长期占用终端、但还没切到 systemd 的节点。

### systemd

```bash
export PMEOW_SERVER_URL=http://your-server:17200
sudo -E pmeow-agent install-service --enable --start
sudo journalctl -u pmeow-agent -f
```

适合长期托管。systemd 负责进程生命周期，journal 负责 runtime log。

#### 运行模型

systemd 模式下，daemon 以 root 身份常驻运行，但会按提交用户的真实身份降权执行后台任务：

- CLI 通过 Unix socket 提交任务时，daemon 从 `SO_PEERCRED` 获取调用者的 uid/gid。
- 后台任务启动前，daemon 会 `setuid`/`setgid` 到提交者身份，并设置 `HOME`、`USER`、`LOGNAME`。
- 任务日志归属和文件权限都跟随提交者而非 daemon 用户。

#### 共享 Socket

systemd 模式下，socket 默认放在 `/run/pmeow-agent/pmeow.sock`，由 systemd `RuntimeDirectory` 管理，服务停止后自动清理。CLI 客户端会自动发现这个路径（优先级：`PMEOW_SOCKET_PATH` > `/run/pmeow-agent/pmeow.sock` > `~/.pmeow/pmeow.sock`）。

默认情况下，socket 权限为 `0666`（所有本地用户均可连接）。如果需要限制访问，可以指定 `PMEOW_SOCKET_GROUP`：

```bash
export PMEOW_SERVER_URL=http://your-server:17200
export PMEOW_SOCKET_GROUP=gpu-users
sudo -E pmeow-agent install-service --enable --start
```

此时 socket 权限为 `0770`，只有 `gpu-users` 组的成员才能提交任务。

#### 环境文件

`install-service` 会把当前 shell 里的 `PMEOW_SERVER_URL` 和其他配置写入 `/etc/pmeow-agent/pmeow-agent.env`，systemd 通过 `EnvironmentFile` 读取。

后续要改上报地址，直接编辑环境文件并重启服务：

```bash
sudoedit /etc/pmeow-agent/pmeow-agent.env
# 改成 PMEOW_SERVER_URL=http://your-server:17200

sudo systemctl restart pmeow-agent
sudo journalctl -u pmeow-agent -f
```

也可以先在当前 shell 里更新环境变量，再重新执行一次 `sudo -E pmeow-agent install-service`，它会覆盖环境文件内容。

#### 卸载

```bash
sudo pmeow-agent uninstall-service
```

这会停止并禁用服务、删除 unit 文件、重新加载 systemd。环境文件 `/etc/pmeow-agent/pmeow-agent.env` 不会被自动删除，如果需要彻底清理：

```bash
sudo rm -rf /etc/pmeow-agent
```

## 节点绑定是怎么发生的

Agent 启动后会向服务端 `/agent` namespace 发送注册、指标、任务状态和心跳事件。绑定过程由服务端按 hostname 完成：

- 如果 `servers.host` 中存在唯一精确匹配的服务器记录，就会自动绑定到该 `serverId`。
- 绑定成功后，该服务器的数据源会切换为 Agent 模式。
- 如果同一个 hostname 对应多条服务器记录，自动绑定会失败，需要先清理重复配置。

因此，在正式接入前，最稳妥的做法是先在 Web 端创建服务器记录，并把 `host` 配置成节点真实 hostname。

## 本地 CLI 工作流

Agent CLI 通过 Unix socket 与本地 daemon 通信。当前实际的任务提交有两种模式：

- **后台模式**（`submit`）：内部 launch mode 是 `background`
- **前台模式**：内部 launch mode 是 `foreground`

> **术语说明**：这里的"前台/后台"指的是**任务提交和执行方式**，与 Agent 守护进程本身的运行方式（`pmeow-agent run` 前台运行 / `pmeow-agent start` 后台运行）是两个独立概念。

常用命令如下：

```bash
# 查看队列摘要
pmeow-agent status

# 查看活跃任务明细
pmeow-agent tasks

# 后台提交 shell 命令
pmeow-agent submit --vram 4096 --gpus 1 python train.py --epochs 50

# 查看日志
pmeow-agent logs <task_id>
pmeow-agent logs <task_id> --tail 50

# 取消任务
pmeow-agent cancel <task_id>
```

当前本地 CLI 没有 `pause` / `resume` 子命令，这两个写法不再适用。

## 后台模式（submit）

`submit` 对应后台启动模式。CLI 会把命令行剩余部分拼成一条 shell 命令字符串，交给 daemon 在资源满足时启动。

```bash
# 1 卡、每卡申请 4096 MB 显存
pmeow-agent submit --vram 4096 --gpus 1 python train.py --epochs 50
pmeow-agent submit --name nightly-train --vram 4096 --gpus 1 python train.py --epochs 50

# 纯 CPU 任务
pmeow-agent submit --vram 0 --gpus 0 bash run_preprocessing.sh
```

当前实际行为：

- `submit` 后面先写参数，然后直接跟要执行的命令。
- CLI 会冻结提交时的 `cwd` 和整份环境变量快照；真正开始运行时，daemon 用这份快照启动进程。
- `submit` 不会改写命令。如果你提交的是 `python train.py`，后台保存和启动的就是这条字面命令。
- daemon 最终按 shell 命令执行，因此重定向、管道和 `&&` 这类 shell 语法会按 shell 语义生效。

资源参数写法：

- `--vram`：每张 GPU 需要的显存，支持 MB 整数或带单位写法，例如 `4096`、`512m`、`7g`
- `--gpus`：需要的 GPU 数量，默认 `1`
- `--gpu`：`--gpus` 的兼容别名
- `--priority`：优先级，数字越小越先调度，默认 `10`
- `--name`：可选任务名，仅用于 Agent 节点本地日志文件名

需要特别注意两点：

- 这里的显存值是“每张 GPU 的需求”，不是多卡总显存。比如 `--vram 4096 --gpus 2` 表示要 2 张 GPU，并且每张都至少能提供 4096 MB。
- 当 `--gpus` 大于 `0` 且 `--vram` 为 `0` 时，调度器按“独占空闲 GPU”处理；当 `--gpus 0` 时表示这是一个不需要 GPU 的任务。

## 前台模式

除了 `pmeow-agent submit`，你也可以直接在当前终端以前台方式运行任务。这个模式通常写成 `pmeow`，内部 launch mode 是 `foreground`。

```bash
pmeow --name nightly-train --vram 10g --gpus 2 python train.py --epochs 50
pmeow --vram 10g --gpus 2 python train.py --epochs 50
pmeow --gpus 1 sh run.sh
pmeow --vram 0 --gpus 0 bash -lc 'echo hi'
```

前台模式必须显式写出完整的命令，不做任何补全或改写。

解析规则：

- PMEOW 参数只能出现在命令前面，且只接受标准的 `--flag value` 或 `--flag=value` 写法。
- 第一个不是 PMEOW 参数的 token 开始，后面的所有内容原样透传给子进程。
- 不需要额外写 `--` 分隔符。

这个模式和 `submit` 的关键差异是：

- daemon 不会在后台替你启动子进程，只负责排队、保留 GPU、记录状态。
- 子进程是在当前等待中的终端里启动的，所以 stdin、stdout 和 stderr 直接接到当前终端。
- 它不会像 `submit` 那样把整份环境变量快照保存到 daemon 侧；最终使用的是等待中的 CLI 进程当时的环境。

资源参数写法：

- `--vram 10g`、`--vram=10g` — 单横线写法（如 `-vram`）不再支持
- `--gpus 2`、`--gpus=2` — 单横线写法（如 `-gpus`）不再支持
- `--priority 5`、`--priority=5`
- `--socket /path/to/pmeow.sock`
- `--name nightly-train`、`--name=nightly-train`

单位规则：

- `--vram 10240` 表示 10240 MB
- `--vram 512m` 表示 512 MB
- `--vram 10g` 表示 10240 MB

### 可选 PyTorch 样例任务

以下样例任务用于测试调度逻辑，需要你自己安装 `torch`。`pmeow-agent` 不会把 `torch` 作为默认依赖。

```bash
pmeow --vram=8g --gpus=1 python examples/tasks/pytorch_hold.py --gpus 1 --mem-per-gpu 7g --seconds 60
pmeow --vram=12g --gpus=2 python examples/tasks/pytorch_stagger.py --memories 5g,11g --seconds 90
pmeow --vram=6g --gpus=1 python examples/tasks/pytorch_chatty.py --gpus 1 --mem-per-gpu 4g --seconds 45 --interval 5
```

## 节点本地会生成哪些文件

默认状态目录是 `~/.pmeow/`：

```text
~/.pmeow/
├── pmeow.db
├── pmeow.sock
├── pmeow-agent.pid
└── logs/
```

这些文件的用途分别是：

- `pmeow.db`：本地 SQLite，保存任务和运行时状态
- `pmeow.sock`：CLI 和 daemon 的控制通道
- `logs/`：任务 stdout 和 stderr 日志
- 日志文件名格式：`yyyymmddhhmmss.mmm-任务名.log`；如果提交时未指定 `--name`，默认使用任务 ID 第一段

## 推荐的首次接入流程

1. 在 Web 控制台先创建服务器记录。
2. 确认服务器记录的 `host` 与节点 hostname 一致。
3. 在节点上安装 Agent 并导出 `PMEOW_SERVER_URL`。
4. 以前台方式启动 `pmeow-agent run`，先确认没有报错。
5. 回到 Web 控制台查看“控制台”“任务调度”“节点详情”是否出现队列与 GPU allocation 数据。
6. 确认无误后，再切换到 systemd 持久运行。

## 节点使用边界

需要特别注意三点：

- Agent 自主调度，服务端只提供最小控制面。
- 任务日志保存在节点本地，服务端不持久化日志内容。
- 队列是否能启动任务，不只取决于当前瞬时显存，还取决于历史窗口内资源是否持续满足。

如果你已经接入了节点但 Web 上看不到状态，继续阅读 [troubleshooting.md](troubleshooting.md)。