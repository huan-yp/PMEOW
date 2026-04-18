# UI 设计说明

## UI 架构

- `App.tsx`
  - 应用总入口。
  - 负责路由注册、认证门禁、侧边栏骨架和全局通知容器挂载。
  - 入口点是 `App`、`AuthGate`、`AppContent`。
- `pages/`
  - 承载具体业务页面。
  - `Overview.tsx`：控制台总览。
  - `Nodes.tsx`：节点列表与节点增删。
  - `NodeDetail.tsx`：节点详情、实时趋势、历史查询、快照回放。
  - `Tasks.tsx`：任务列表。
  - `TaskDetail.tsx`：任务详情与基础调度操作。
  - `Alerts.tsx`：告警历史、忽略管理与批量操作。
  - `People.tsx`、`PersonCreateWizard.tsx`、`PersonDetail.tsx`：人员、绑定关系、时间线与任务视图。
  - `Security.tsx`：安全事件展示和处置。
  - `Settings.tsx`：系统阈值配置与系统信息。
  - `Login.tsx`：登录入口。
- `components/`
  - 负责可复用展示组件。
  - `TimeSeriesChart.tsx`：统一折线图基座。
  - `GpuBar.tsx`：单卡显存占用和预留的横条可视化。
  - `ServerCard.tsx`：节点摘要卡片。
  - `ProcessTable.tsx`：进程列表与基础排序。
  - `SnapshotTimePicker.tsx`：历史快照时间点选择。
  - `common/Toast.tsx`：全局通知展示。
- `store/`
  - 维护 UI 全局前端状态。
  - `useStore.ts`：保存认证状态、节点列表、节点在线状态、最新快照、安全事件和通知消息。
  - 跨页面共享且需要实时刷新的数据优先放这里。
- `hooks/`
  - 封装 UI 侧的数据接入逻辑。
  - `useMetrics.ts`：首屏初始化加载和 WebSocket 实时订阅。
  - `useRealtimeData.ts`：任务、告警、安全事件的按需拉取辅助逻辑。
- `transport/`
  - 负责和 Web 模块通信。
  - `TransportProvider.tsx`：向整个 React 树注入统一 transport 实例。
  - `ws-adapter.ts`：封装 WebSocket 订阅和 REST 请求。
  - `types.ts`：定义 UI 消费的数据结构和 transport 接口。
- `utils/`
  - 负责纯前端派生计算。
  - 包括状态映射、带宽格式化、显存格式化、GPU 归属分组、颜色分配等。
- `styles/`
  - 负责全局样式和品牌化外观。
  - 不参与业务数据流，只承担展示表达。

## UI 数据/控制流

### 页面控制流

```text
浏览器进入
→ `App.tsx` 初始化
→ `transport/TransportProvider.tsx` 建立 transport
→ `AuthGate` 检查登录状态
→ 未登录进入 `pages/Login.tsx`
→ 已登录进入主壳层
→ 首屏并发加载 servers / statuses / latestMetrics
→ 建立 WebSocket 实时订阅
→ 各页面按路由挂载
→ 页面按需发起详情查询或操作请求
→ 操作成功后更新页面状态或全局状态
```

### 实时状态流

```text
后端推送 metricsUpdate / serverStatus / taskEvent / alert / securityEvent
→ `hooks/useMetrics.ts` 接收事件
→ 写入 `store/useStore.ts` 中的 statuses / latestSnapshots / securityEvents / tasks
→ 必要时触发 servers 刷新
→ 同时写入 toast
→ `pages/Overview.tsx` / `pages/NodeDetail.tsx` / `components/ServerCard.tsx` 等订阅方自动重渲染
```

### 节点详情数据流

```text
进入 `pages/NodeDetail.tsx`
→ 先从 `store/useStore.ts` 读取当前节点最新快照
→ 再请求最近一段历史数据补齐实时曲线
→ 新的 metricsUpdate 到达后追加到本地图表缓存
→ 切到 history tab 时按时间范围请求历史快照
→ 切到 snapshot tab 时拉取快照时间轴
→ 选择某个时间点后回放该时刻的资源、进程和 GPU 分配
```

### 列表页数据流

```text
进入 `pages/Tasks.tsx` / `pages/Alerts.tsx` / `pages/People.tsx` / `pages/Security.tsx` / `pages/Settings.tsx`
→ 页面 `useEffect` 发起 REST 请求
→ 返回结果进入页面本地 state
→ 用户进行筛选、分页、排序、批量操作
→ 再次请求接口或提交动作接口
→ 用返回结果刷新当前页面
```

### 人员向导控制流

```text
进入 `pages/PersonCreateWizard.tsx`
→ 拉取系统用户候选
→ 选择创建模式
→ 选择种子账号或直接手工建档
→ 填写人员信息
→ 选择需要绑定的系统账号
→ 检查冲突并确认迁移
→ 单次提交 createPersonWizard
→ 成功后跳转 `pages/PersonDetail.tsx`
```

### 告警与安全事件流

```text
后端产生告警或安全事件
→ WebSocket 推送到前端
→ `store/useStore.ts` 与 `common/Toast.tsx` 先更新摘要态
→ `pages/Alerts.tsx` 在告警事件到来后主动 reload
→ `pages/Security.tsx` 以页面查询结果为主，用户执行 mark safe 或 unresolve 后重新拉取
```

### UI 展示数据流

```text
后端原始数据
→ `transport/types.ts` 约束结构
→ `store/useStore.ts` 或页面本地 state 持有原始对象
→ `utils/` 做状态映射、格式化、分组聚合
→ `components/` 做图表、横条、表格、卡片渲染
→ 用户看到总览、详情、历史和事件提示
```

## UI 当前边界

- UI 以轻逻辑为主，不承担调度决策，只负责展示、筛选、跳转和触发操作。
- 实时监控数据主要走 `store/useStore.ts`。
- 业务列表和详情数据主要走页面本地 state。
- 图表和横条组件承担了大部分可视化复杂度。
- 认证、传输、全局状态、页面展示目前是清晰分层的。
- 任务、告警、人员这些域当前还没有完全统一到同一套前端状态模型中。