import { useState } from 'react';
import { useStore } from '../store/useStore.js';
import { GpuOverviewCard } from '../components/GpuOverviewCard.js';
import { ServerCard } from '../components/ServerCard.js';

type Panel = 'monitor' | 'nodes';

function formatSecurityEventType(eventType: string) {
  switch (eventType) {
    case 'suspicious_process':
      return '可疑进程';
    case 'unowned_gpu':
      return '未知 GPU 占用';
    case 'marked_safe':
      return '已标记安全';
    default:
      return eventType;
  }
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function Overview() {
  const [panel, setPanel] = useState<Panel>('monitor');
  const { servers, statuses, latestMetrics, taskQueueGroups, openSecurityEvents } = useStore();

  const onlineCount = servers.filter((server) => statuses.get(server.id)?.status === 'connected').length;
  const offlineCount = Math.max(servers.length - onlineCount, 0);
  const queuedCount = taskQueueGroups.reduce((sum, group) => sum + group.queued.length, 0);
  const runningCount = taskQueueGroups.reduce((sum, group) => sum + group.running.length, 0);
  const recentCount = taskQueueGroups.reduce((sum, group) => sum + group.recent.length, 0);
  const riskyNodeCount = new Set(openSecurityEvents.map((event) => event.serverId)).size;
  const latestMetricTimestamp = Array.from(latestMetrics.values()).reduce(
    (latest, snapshot) => Math.max(latest, snapshot.timestamp),
    0,
  );

  // Internet reachability aggregation — only consider snapshots that carry
  // probe results (the field is optional; SSH nodes with an older collector
  // or Agents that have disabled the probe will not set it).
  const networkSnapshots = Array.from(latestMetrics.values()).filter(
    (s) => s.network.internetReachable !== undefined,
  );
  const internetReachableCount = networkSnapshots.filter(
    (s) => s.network.internetReachable === true,
  ).length;
  const internetUnreachableCount = networkSnapshots.filter(
    (s) => s.network.internetReachable === false,
  ).length;
  const hasInternetData = networkSnapshots.length > 0;
  const activeTaskGroups = [...taskQueueGroups]
    .sort((left, right) => (right.running.length + right.queued.length) - (left.running.length + left.queued.length))
    .slice(0, 3);
  const latestSecurityEvents = [...openSecurityEvents]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, 3);

  const stats = [
    {
      key: 'presence',
      label: '在线节点',
      value: servers.length === 0 ? '0' : `${onlineCount}/${servers.length}`,
      hint: servers.length === 0 ? '等待节点接入' : offlineCount === 0 ? '当前全部在线' : `${offlineCount} 个节点离线`,
      cardClassName: 'border-sky-400/20 bg-sky-500/[0.07] shadow-[0_18px_48px_rgba(14,165,233,0.08)]',
      valueClassName: 'text-sky-100',
      hintClassName: offlineCount > 0 ? 'text-rose-200/75' : 'text-sky-100/75',
      badges: servers.length > 0
        ? [
            { label: '在线', value: String(onlineCount), className: 'node-badge-base node-badge-status-online' },
            { label: '离线', value: String(offlineCount), className: 'node-badge-base node-badge-status-offline' },
          ]
        : [],
    },
    {
      key: 'load',
      label: '任务负载',
      value: String(queuedCount + runningCount),
      hint: `排队 ${queuedCount} · 运行 ${runningCount}`,
      cardClassName: 'border-cyan-400/12 bg-cyan-500/[0.04]',
      valueClassName: 'text-slate-100',
      hintClassName: 'text-slate-400',
      badges: [],
    },
    {
      key: 'risk',
      label: '待处理风险',
      value: String(openSecurityEvents.length),
      hint: openSecurityEvents.length === 0 ? '过去 7 天未发现未处理事件' : `${riskyNodeCount} 个节点存在风险`,
      cardClassName: 'border-amber-400/16 bg-amber-400/[0.05]',
      valueClassName: 'text-amber-100',
      hintClassName: 'text-slate-300/80',
      badges: [],
    },
    {
      key: 'internet',
      label: '外网连通',
      value: hasInternetData
        ? `${internetReachableCount}/${networkSnapshots.length}`
        : '--',
      hint: !hasInternetData
        ? '等待节点上报外网探测数据'
        : internetUnreachableCount === 0
          ? '所有上报节点外网畅通'
          : `${internetUnreachableCount} 个节点外网不可达`,
      cardClassName: !hasInternetData
        ? 'border-white/10 bg-slate-950/30'
        : internetUnreachableCount > 0
          ? 'border-rose-400/20 bg-rose-500/[0.07]'
          : 'border-emerald-400/20 bg-emerald-500/[0.06]',
      valueClassName: 'text-slate-100',
      hintClassName: !hasInternetData
        ? 'text-slate-400'
        : internetUnreachableCount > 0
          ? 'text-rose-300/80'
          : 'text-emerald-300/75',
      badges: hasInternetData
        ? [
            { label: '可达', value: String(internetReachableCount), className: 'node-badge-base node-badge-status-online' },
            { label: '不可达', value: String(internetUnreachableCount), className: 'node-badge-base node-badge-status-offline' },
          ]
        : [],
    },
    {
      key: 'sampling',
      label: '最新采样',
      value: latestMetricTimestamp > 0 ? formatTime(latestMetricTimestamp) : '--',
      hint: latestMetricTimestamp > 0 ? '来自节点实时指标' : '等待第一批数据上报',
      cardClassName: 'border-white/10 bg-slate-950/30',
      valueClassName: 'text-slate-100',
      hintClassName: 'text-slate-400',
      badges: [],
    },
  ];

  const panels: { key: Panel; label: string }[] = [
    { key: 'monitor', label: '运行监控' },
    { key: 'nodes', label: '节点态势' },
  ];

  return (
    <div className="p-6 space-y-6">
      <section>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {stats.map((item) => (
            <div key={item.key} className={`rounded-2xl border p-4 backdrop-blur-sm ${item.cardClassName}`}>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{item.label}</p>
              <p className={`mt-3 text-2xl font-semibold ${item.valueClassName}`}>{item.value}</p>
              {item.badges.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.badges.map((badge) => (
                    <span key={badge.label} className={badge.className}>
                      {badge.label} {badge.value}
                    </span>
                  ))}
                </div>
              )}
              <p className={`${item.badges.length > 0 ? 'mt-3' : 'mt-2'} text-xs ${item.hintClassName}`}>{item.hint}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Panel tabs */}
      <div className="flex gap-1 border-b border-dark-border">
        {panels.map((p) => (
          <button
            key={p.key}
            onClick={() => setPanel(p.key)}
            className={`px-5 py-2.5 text-sm font-medium transition-colors ${
              panel === p.key
                ? 'text-accent-blue border-b-2 border-accent-blue'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Panel: 运行监控 (节点运行视图) */}
      {panel === 'monitor' && (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="brand-kicker">NODES</p>
              <h2 className="mt-2 text-xl font-semibold text-slate-100">节点运行视图</h2>
              <p className="mt-1 text-sm text-slate-500">按 CPU、内存、网络和 GPU 指标快速检查当前节点状态。</p>
            </div>
            <div className="text-sm text-slate-500">
              {latestMetricTimestamp > 0 ? `最近采样 ${formatTimestamp(latestMetricTimestamp)}` : '等待第一批节点指标上报'}
            </div>
          </div>

          {servers.length === 0 ? (
            <div className="brand-card flex h-64 items-center justify-center rounded-3xl border border-dashed border-dark-border">
              <div className="text-center">
                <p className="text-lg text-slate-300">暂无节点</p>
                <p className="mt-2 text-sm text-slate-500">前往「节点管理」页面接入节点，PMEOW 会自动开始汇聚指标和调度视图。</p>
              </div>
            </div>
          ) : (
            <div className={`grid gap-4 ${
              servers.length <= 2 ? 'grid-cols-1 md:grid-cols-2' :
              servers.length <= 4 ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-2' :
              'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
            }`}>
              {servers.map((server) => (
                <ServerCard
                  key={server.id}
                  server={server}
                  status={statuses.get(server.id)}
                  metrics={latestMetrics.get(server.id)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Panel: 节点态势 */}
      {panel === 'nodes' && (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <section className="brand-card rounded-2xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="brand-kicker">SCHEDULING</p>
                  <h2 className="mt-2 text-lg font-semibold text-slate-100">调度态势</h2>
                  <p className="mt-1 text-sm text-slate-500">基于节点上报的任务队列镜像，识别排队压力与运行热点。</p>
                </div>
                <span className="rounded-full border border-accent-blue/20 bg-accent-blue/10 px-3 py-1 text-xs text-accent-blue">
                  最近完成 {recentCount}
                </span>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-dark-border/70 bg-dark-bg/40 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">排队中</p>
                  <p className="mt-2 text-xl font-semibold text-slate-100">{queuedCount}</p>
                </div>
                <div className="rounded-2xl border border-dark-border/70 bg-dark-bg/40 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">运行中</p>
                  <p className="mt-2 text-xl font-semibold text-slate-100">{runningCount}</p>
                </div>
                <div className="rounded-2xl border border-dark-border/70 bg-dark-bg/40 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">最近完成</p>
                  <p className="mt-2 text-xl font-semibold text-slate-100">{recentCount}</p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {activeTaskGroups.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-dark-border bg-dark-bg/30 px-4 py-5 text-sm text-slate-500">
                    暂无任务队列数据，等待节点开始上报。
                  </div>
                ) : (
                  activeTaskGroups.map((group) => (
                    <div key={group.serverId} className="rounded-2xl border border-dark-border/70 bg-dark-bg/40 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-slate-100">{group.serverName}</p>
                          <p className="mt-1 text-xs text-slate-500">节点 ID {group.serverId}</p>
                        </div>
                        <p className="text-xs text-slate-400">
                          排队 {group.queued.length} · 运行 {group.running.length} · 最近 {group.recent.length}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="brand-card rounded-2xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="brand-kicker">SECURITY</p>
                  <h2 className="mt-2 text-lg font-semibold text-slate-100">审计态势</h2>
                  <p className="mt-1 text-sm text-slate-500">聚焦未知 GPU 占用与可疑进程，帮助快速收敛风险节点。</p>
                </div>
                <span className="rounded-full border border-accent-yellow/20 bg-accent-yellow/10 px-3 py-1 text-xs text-accent-yellow">
                  待处理 {openSecurityEvents.length}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {latestSecurityEvents.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-dark-border bg-dark-bg/30 px-4 py-5">
                    <p className="text-sm text-slate-300">当前无未处理安全事件</p>
                    <p className="mt-1 text-xs text-slate-500">节点 GPU 归属和可疑进程审计结果会在这里汇总展示。</p>
                  </div>
                ) : (
                  latestSecurityEvents.map((event) => (
                    <div key={event.id} className="rounded-2xl border border-dark-border/70 bg-dark-bg/40 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-slate-100">{formatSecurityEventType(event.eventType)}</p>
                          <p className="mt-1 text-xs text-slate-500">节点 ID {event.serverId} · {formatTimestamp(event.createdAt)}</p>
                        </div>
                        <span className="rounded-full bg-accent-yellow/10 px-2.5 py-1 text-xs text-accent-yellow">待处理</span>
                      </div>
                      <p className="mt-3 text-sm text-slate-300">{event.details.reason}</p>
                      {event.details.command ? (
                        <p className="mt-2 break-all font-mono text-xs text-slate-500">{event.details.command}</p>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <GpuOverviewCard />
        </>
      )}
    </div>
  );
}
