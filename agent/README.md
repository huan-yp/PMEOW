# pmeow-agent

`pmeow-agent` 是 PMEOW 的独立 Python Agent。它运行在计算节点本地，负责本地指标采集、GPU 归属识别、本地任务队列，以及通过 Socket.IO 回连 PMEOW Web 服务。

如果你是在仓库内开发或部署节点，也建议同时阅读 [../docs/user/agent-nodes.md](../docs/user/agent-nodes.md)。

## 运行要求

- Python 3.8+
- Linux（依赖 `/proc` 采集系统指标）
- 可选：NVIDIA GPU 与 `nvidia-smi`，用于 GPU 指标和 GPU 归属视图

## 安装

### 从 PyPI 安装

```bash
pip install pmeow-agent
```

### 推荐的系统级安装（独立虚拟环境）

生产环境更推荐给 Agent 单独建一个系统级虚拟环境，而不是把它装进某个项目自己的 venv：

```bash
sudo mkdir -p /opt/pmeow-agent
sudo python3 -m venv /opt/pmeow-agent/.venv
sudo /opt/pmeow-agent/.venv/bin/pip install --upgrade pip
sudo /opt/pmeow-agent/.venv/bin/pip install pmeow-agent
sudo ln -sf /opt/pmeow-agent/.venv/bin/pmeow-agent /usr/local/bin/pmeow-agent
sudo ln -sf /opt/pmeow-agent/.venv/bin/pmeow /usr/local/bin/pmeow
```

这样 `pmeow-agent` 和 `pmeow` 在节点上只有一份固定安装，systemd 也可以稳定指向这套解释器；

如果某个项目虚拟环境里也安装了另一份 `pmeow-agent`，shell 会优先命中那一份；想强制走系统级命令时，请显式调用 `/usr/local/bin/pmeow` 或 `/usr/local/bin/pmeow-agent`。

### 从源码安装（开发模式）

```bash
cd agent
python3 -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
```

## 使用方式

### 前台运行

```bash
export PMEOW_SERVER_URL=http://your-server:17200
pmeow-agent run
```

当前更推荐写成 `pmeow-agent run`。前台模式会把 Agent 运行日志直接打印到当前终端，适合首次接入和现场排障。

### 后台运行

```bash
export PMEOW_SERVER_URL=http://your-server:17200
export PMEOW_AGENT_LOG_FILE=~/.pmeow/agent.log
pmeow-agent start
pmeow-agent is-running
pmeow-agent stop
```

后台模式会把 Agent 运行日志写入 `PMEOW_AGENT_LOG_FILE`，任务的 stdout 和 stderr 仍然写入 `PMEOW_LOG_DIR`。

### 安装为 systemd service

```bash
sudo pmeow-agent install-service --enable --start
sudo pmeow-agent uninstall-service
```

systemd 会以前台模式托管进程，运行日志进入 journal。

如果你按上面的独立虚拟环境方式安装，`install-service` 会把 `ExecStart` 固定到系统级 `pmeow-agent` 可执行文件，并把 `WorkingDirectory` 设为 `PMEOW_STATE_DIR`，不再依赖你执行安装命令时所在的目录。

### 提交任务

```bash
pmeow-agent submit --vram 4000 --gpus 1 python train.py

# 如果不需要 GPU
pmeow-agent submit --vram 0 --gpus 0 bash run_preprocessing.sh
```

常用参数：

- `--vram`：每张 GPU 需要的显存，单位 MB，默认 `0`
- `--gpus`：需要的 GPU 数量，默认 `1`
- `--gpu`：`--gpus` 的兼容别名
- `--priority`：优先级，数字越小越先调度，默认 `10`

`submit` 模式的执行语义有两点需要注意：

- `submit` 后面直接跟命令，不要再额外写一个独立的 `--`；当前实现会把这个 `--` 也保存进命令字符串。
- 提交时会冻结当前工作目录和当前进程环境；任务真正开始时，daemon 会用这份 cwd 和整份环境快照启动命令。
- `submit` 不会改写你输入的命令；如果你写的是 `python train.py`，真正排队保存的就是这条原始命令。需要固定解释器时，请显式写绝对路径，或者改用下方的前台模式。
- `--vram` 表示每张 GPU 的显存需求，不是多卡总显存。比如 `--vram 4096 --gpus 2` 表示需要 2 张 GPU，并且每张都至少满足 4096 MB。

### 查看队列状态

```bash
pmeow-agent status
```

该命令当前输出的是 `queued`、`reserved` 和 `running` 三个数量。

如果需要看活跃任务明细，可以用：

```bash
pmeow-agent tasks
```

### 查看任务日志

```bash
pmeow-agent logs <task_id>
pmeow-agent logs <task_id> --tail 50
```

### 取消任务

```bash
pmeow-agent cancel <task_id>
```

### 前台模式

```bash
pmeow --vram 10g --gpus 2 python train.py --epochs 50
pmeow --gpus 1 sh run.sh
```

规则如下：

- PMEOW 参数只能出现在命令前面，且只接受标准的 `--flag value` 或 `--flag=value` 写法（单横线写法如 `-vram` 不再支持）。
- 第一个不是 PMEOW 参数的 token 开始，后面的所有内容原样透传给子进程。
- GPU 资源就绪后，同一个终端会直接切换成子进程的 stdin、stdout 和 stderr。

资源参数规则：

- `--vram` 支持 MB 整数，或者 `m` / `g` 后缀，例如 `10240`、`512m`、`10g`
- `--gpus` 表示 GPU 数量
- 显存值同样表示“每张 GPU 的需求”，不是总显存

前台模式和 `submit` 的区别是：

- daemon 只负责排队、资源保留和状态同步；真正的子进程是在当前等待中的终端里以前台 attached 方式启动。
- 启动时仍然使用提交时记录的工作目录与命令参数；stdin、stdout 和 stderr 行为更接近你直接在这个终端里执行同一条命令。
- 调度器仍然会额外注入 `CUDA_VISIBLE_DEVICES`，所以它不是完全裸的本地执行，而是"带资源绑定的前台命令"。

> **术语说明**：这里的"前台"指的是任务的执行方式（在当前终端前台运行），与 Agent 守护进程本身的运行方式（`pmeow-agent run` 前台运行 Agent）是两个独立概念。

### 可选的 PyTorch 样例任务

PyTorch 样例任务是可选能力。使用前请自行安装与当前 CUDA 运行时匹配的 `torch`；`pmeow-agent` 不会把 `torch` 作为默认依赖。

```bash
pmeow --vram=8g --gpus=1 python examples/tasks/pytorch_hold.py --gpus 1 --mem-per-gpu 7g --seconds 60
pmeow --vram=12g --gpus=2 python examples/tasks/pytorch_stagger.py --memories 5g,11g --seconds 90
pmeow --vram=6g --gpus=1 python examples/tasks/pytorch_chatty.py --gpus 1 --mem-per-gpu 4g --seconds 45 --interval 5
```

## 环境变量

Agent 通过环境变量配置；未设置时会使用默认值。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PMEOW_SERVER_URL` | 空 | PMEOW Web 服务基础 URL，例如 `http://server:17200` |
| `PMEOW_WS_RECONNECT_DELAY` | `0.5` | Socket.IO 断线后首次重连等待时间，单位秒 |
| `PMEOW_WS_RECONNECT_DELAY_MAX` | `5.0` | Socket.IO 重连退避上限，单位秒 |
| `PMEOW_WS_REQUEST_TIMEOUT` | `3.0` | Socket.IO 建连 / 请求超时，单位秒 |
| `PMEOW_AGENT_ID` | hostname | 当前 Agent 的唯一标识 |
| `PMEOW_COLLECTION_INTERVAL` | `5` | 指标采集间隔，单位秒 |
| `PMEOW_HEARTBEAT_INTERVAL` | `30` | 心跳上报间隔，单位秒 |
| `PMEOW_HISTORY_WINDOW` | `5` | 调度时参考的历史窗口，单位秒 |
| `PMEOW_VRAM_REDUNDANCY` | `0.1` | 显存冗余系数，用于给非 PMEOW 进程预留安全余量 |
| `PMEOW_STATE_DIR` | `~/.pmeow/` | 本地状态目录 |
| `PMEOW_SOCKET_PATH` | `~/.pmeow/pmeow.sock` | CLI 与 daemon 通信的 Unix socket |
| `PMEOW_LOG_DIR` | `~/.pmeow/logs/` | 任务 stdout 和 stderr 日志目录 |
| `PMEOW_PID_FILE` | `~/.pmeow/pmeow-agent.pid` | 后台模式使用的 pid 文件 |
| `PMEOW_AGENT_LOG_FILE` | 空 | 后台模式使用的专用运行日志文件 |

`PMEOW_SERVER_URL` 需要指向 PMEOW Web 服务的基础 URL。Agent transport 会自动连接 Socket.IO `/agent` namespace；不要自己拼 `/agent`，也不要改成原始 WebSocket URL。

如果节点网络抖动较多，优先调 `PMEOW_WS_RECONNECT_DELAY_MAX` 和 `PMEOW_WS_REQUEST_TIMEOUT`；默认值已经比旧配置更激进，断线后会更快重新尝试连接。

## 状态目录

默认情况下，所有 Agent 状态都保存在 `~/.pmeow/` 下：

```text
~/.pmeow/
├── pmeow.db        # 本地 SQLite（任务和运行状态）
├── pmeow.sock      # Unix domain socket（daemon 控制通道）
├── pmeow-agent.pid # pid 文件，仅后台模式使用
└── logs/
    ├── <task_id>.log
    └── ...
```

## 开发与测试

```bash
pip install -e ".[dev]"
pytest -v
```

## 与服务端集成说明

- Agent 会通过 Socket.IO 向服务端发送 `agent:register`、`agent:metrics`、`agent:taskUpdate` 和 `agent:heartbeat`
- 节点在线时，服务端可能会回发 `server:cancelTask`、`server:pauseQueue`、`server:resumeQueue` 和 `server:setPriority`
- 服务端侧的自动绑定基于 hostname 精确匹配；如果你希望自动绑定成功，应让 Web 侧 `servers.host` 与节点 hostname 保持一致
