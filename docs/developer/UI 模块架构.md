# UI 模块架构

React SPA，同时支持 Web 浏览器和 Android App（Capacitor）。

## 职责

- 通过 WebSocket 订阅实时推送（指标、任务事件、告警变化、安全事件）
- 通过 REST API 拉取列表和历史数据
- 纯展示层，不持有业务逻辑

## 目录结构

- `main.tsx` — React 入口
- `App.tsx` — 根组件：路由定义、侧边栏、`TransportProvider` 包裹
- `transport/`
  - `ws-adapter.ts` — Socket.IO 客户端封装，实现 `TransportAdapter` 接口
  - `TransportProvider.tsx` — React Context，管理连接生命周期
  - `types.ts` — 前端侧所有数据模型定义
- `store/`
  - `useStore.ts` — Zustand 全局 store：servers、实时快照、tasks、alerts、security events、toasts
- `hooks/`
  - `useMetrics.ts` — 订阅 WebSocket 推送事件，更新 store
  - `useRealtimeData.ts` — 挂载时按需拉取 tasks / alerts / security events
- `pages/`
  - `Overview.tsx` — 仪表盘：在线/离线汇总、网络可达性、安全事件
  - `Nodes.tsx` — 节点列表：增删节点
  - `NodeDetail/` — 节点详情（多 tab：实时、快照、历史、进程）
    - `tabs/` — RealtimeTab、SnapshotTab、HistoryTab、ProcessesTab
    - `hooks/` — useRealtimeMetrics、useSnapshotData、useHistoryData
    - `components/` — StatCard、GpuTrendDisclosure、DiskUsageBars 等
    - `utils/` — 图表配置、GPU 计算、历史数据处理
  - `Tasks.tsx` / `TaskDetail.tsx` — 任务列表和详情
  - `Alerts.tsx` — 告警列表，支持静默/取消静默
  - `People.tsx` / `PersonDetail.tsx` / `PersonCreateWizard.tsx` — 人员管理
  - `Security.tsx` — 安全事件列表
  - `Settings.tsx` — 全局设置
  - `Login.tsx` — 登录
- `components/`
  - `TimeSeriesChart.tsx` — ECharts 折线图通用封装
  - `GpuBar.tsx` — GPU 显存横条（按人员涂色）
  - `ProcessTable.tsx` — 进程列表
  - `ServerCard.tsx` — 节点卡片
  - `SnapshotTimePicker.tsx` — 快照时间选择器
  - `ProgressBar.tsx` — 进度条
  - `common/Toast.tsx` — Toast 通知
- `utils/`
  - `gpuAllocation.ts` — GPU 显存按 owner 分组计算
  - `ownerColor.ts` — 人员→颜色映射
  - `metricChart.ts` — 图表格式化
  - `rates.ts` — 速率单位换算
  - `vram.ts` — 显存工具函数
  - `nodeStatus.ts` — 节点状态辅助
  - `branding.ts` — 品牌信息常量

## 数据流

```
Web 服务端
  │
  ├── WebSocket 推送 ──▶ useMetrics ──▶ Zustand store ──▶ 页面响应式更新
  │     metricsUpdate        订阅事件        更新快照/列表
  │     taskEvent
  │     alertStateChange
  │     securityEvent
  │     serverStatus
  │
  └── REST API ──▶ useRealtimeData / 各页面按需拉取
        /api/tasks           挂载时拉取列表数据
        /api/alerts          翻页 / 筛选时重新拉取
        /api/snapshots
        ...
```

## 通信约定

- WebSocket 用于实时推送，前端只接收不主动发
- WebSocket 推送内容受服务端 `Principal` 权限过滤（详见 Web 模块架构）
- REST API 用于列表查询、控制操作（取消任务、静默告警、人员令牌管理等）
- 人员令牌 CRUD（签发、吊销、轮换）通过 REST API 调用，管理入口在人员详情页
- 认证 token 存 localStorage，WebSocket 和 REST 共用