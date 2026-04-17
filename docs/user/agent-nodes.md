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

### 从源码安装

```bash
cd agent
python3 -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
```

如果你只打算运行 Agent 而不是开发它，也可以把源码放到固定目录后再用虚拟环境安装。

## 关键环境变量

Agent 通过环境变量配置，未设置时会使用默认值。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PMEOW_SERVER_URL` | 空 | Web 服务基础地址，例如 `http://server:17200` |
| `PMEOW_AGENT_ID` | 当前 hostname | Agent 唯一标识 |
| `PMEOW_COLLECTION_INTERVAL` | `5` | 指标采集周期，单位秒 |
| `PMEOW_HEARTBEAT_INTERVAL` | `30` | 心跳间隔，单位秒 |
| `PMEOW_HISTORY_WINDOW` | `120` | 调度时参考的历史窗口，单位秒 |
| `PMEOW_VRAM_REDUNDANCY` | `0.1` | 非 PMEOW 进程显存冗余系数 |
| `PMEOW_STATE_DIR` | `~/.pmeow/` | 本地状态目录 |
| `PMEOW_SOCKET_PATH` | `~/.pmeow/pmeow.sock` | CLI 与 daemon 通信的 Unix socket |
| `PMEOW_LOG_DIR` | `~/.pmeow/logs/` | 任务日志目录 |
| `PMEOW_LOG_LEVEL` | `INFO` | Agent runtime log 级别，可设为 `DEBUG` |
| `PMEOW_PID_FILE` | `~/.pmeow/pmeow-agent.pid` | 后台模式 pid 文件 |
| `PMEOW_AGENT_LOG_FILE` | 空 | 后台模式 runtime log 文件 |

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
sudo pmeow-agent install-service --enable --start
sudo journalctl -u pmeow-agent -f
```

适合长期托管。systemd 负责进程生命周期，journal 负责 runtime log。

## 节点绑定是怎么发生的

Agent 启动后会向服务端 `/agent` namespace 发送注册、指标、任务状态和心跳事件。绑定过程由服务端按 hostname 完成：

- 如果 `servers.host` 中存在唯一精确匹配的服务器记录，就会自动绑定到该 `serverId`。
- 绑定成功后，该服务器的数据源会切换为 Agent 模式。
- 如果同一个 hostname 对应多条服务器记录，自动绑定会失败，需要先清理重复配置。

因此，在正式接入前，最稳妥的做法是先在 Web 端创建服务器记录，并把 `host` 配置成节点真实 hostname。

## 本地 CLI 工作流

Agent CLI 通过 Unix socket 与本地 daemon 通信，常用命令如下：

```bash
# 查看队列摘要
pmeow-agent status

# 提交任务
pmeow-agent submit --pvram 4000 --gpu 1 -- python train.py

# 查看日志
pmeow-agent logs <task_id>
pmeow-agent logs <task_id> --tail 50

# 取消任务
pmeow-agent cancel <task_id>

# 暂停 / 恢复队列
pmeow-agent pause
pmeow-agent resume
```

当前 CLI 的 `submit` 命令会把命令行剩余部分拼成一条 shell 命令字符串，并记录当前工作目录和当前系统用户名。

`submit` 模式还有两个关键特点：

- 提交时会把当前工作目录和当前进程环境整体保存到任务记录里；真正开始运行时，daemon 会按这份快照启动任务。
- 如果命令形态是 `python ...`、`py ...` 或 `python3 ...` 且后面跟的是脚本、`-m` 或 `-c`，CLI 会把解释器固定成提交侧当前的 `sys.executable`，避免排队后切换到 daemon 自身 PATH 中的其他 Python。

## Python 直达模式

除了 `pmeow-agent submit` 命令，你也可以用更简洁的语法直接提交 Python 脚本：

```bash
pmeow -vram=10g -gpus=2 --report train.py --epochs 50
```

规则：

- `.py` 路径之前的 token 是 PMEOW flags（`-vram`、`-gpus`、`--priority`、`--report`）
- `.py` 路径之后的 token 原样传给 Python
- `--report` 在排队期间打印队列尝试和 GPU 占用概览
- GPU 资源到位后，当前终端直接变成 Python 进程的 stdin、stdout 和 stderr

这意味着 Python 直达模式更接近“排队成功后在当前终端前台执行 Python”：

- daemon 不会替你在后台真正拉起 Python 子进程，而是由当前等待中的终端在资源就绪后 attached 启动。
- 工作目录沿用提交时 cwd，Python argv 沿用提交时记录的解释器与脚本参数。
- 环境来自当前等待进程所在终端，并由调度器额外注入 `CUDA_VISIBLE_DEVICES`。

### 可选 PyTorch 样例任务

以下样例任务用于测试调度逻辑，需要你自己安装 `torch`。`pmeow-agent` 不会把 `torch` 作为默认依赖。

```bash
pmeow -vram=8g -gpus=1 examples/tasks/pytorch_hold.py --gpus 1 --mem-per-gpu 7g --seconds 60
pmeow -vram=12g -gpus=2 --report examples/tasks/pytorch_stagger.py --memories 5g,11g --seconds 90
pmeow -vram=6g -gpus=1 examples/tasks/pytorch_chatty.py --gpus 1 --mem-per-gpu 4g --seconds 45 --interval 5
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