import { useState } from 'react';
import { useStore } from '../store/useStore.js';
import { GpuOverviewCard } from '../components/GpuOverviewCard.js';
import { ServerCard } from '../components/ServerCard.js';
import { getInternetReachabilityState } from '../utils/nodeStatus.js';

type Panel = 'monitor' | 'nodes';

type OverviewStatBadge = {
  label: string;
  value: string;
  className: string;
};

type OverviewStatCard = {
  key: string;
  label: string;
  value: string;
  hint: string;
  cardClassName: string;
  valueClassName: string;
  hintClassName: string;
  badges: OverviewStatBadge[];
};

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

  const connectionSummary = servers.reduce(
    (summary, server) => {
      const connectionState = statuses.get(server.id)?.status ?? 'disconnected';
      if (connectionState === 'connected') {
        summary.online += 1;
      } else if (connectionState === 'connecting') {
        summary.connecting += 1;
      } else if (connectionState === 'error') {
        summary.error += 1;
      } else {
        summary.offline += 1;
      }
      return summary;
    },
    { online: 0, offline: 0, connecting: 0, error: 0 },
  );
  const onlineCount = connectionSummary.online;
  const offlineCount = connectionSummary.offline;
  const queuedCount = taskQueueGroups.reduce((sum, group) => sum + group.queued.length, 0);
  const runningCount = taskQueueGroups.reduce((sum, group) => sum + group.running.length, 0);
  const recentCount = taskQueueGroups.reduce((sum, group) => sum + group.recent.length, 0);
  const riskyNodeCount = new Set(openSecurityEvents.map((event) => event.serverId)).size;
  const latestMetricTimestamp = Array.from(latestMetrics.values()).reduce(
    (latest, snapshot) => Math.max(latest, snapshot.timestamp),
    0,
  );

  const internetSummary = servers.reduce(
    (summary, server) => {
      const state = getInternetReachabilityState(latestMetrics.get(server.id));
      if (state === 'reachable') {
        summary.reachable += 1;
      } else if (state === 'unreachable') {
        summary.unreachable += 1;
      } else {
        summary.unprobed += 1;
      }
      return summary;
    },
    { reachable: 0, unreachable: 0, unprobed: 0 },
  );
  const hasInternetData = servers.length > 0 && internetSummary.unprobed < servers.length;
  const activeTaskGroups = [...taskQueueGroups]
    .sort((left, right) => (right.running.length + right.queued.length) - (left.running.length + left.queued.length))
    .slice(0, 3);
  const latestSecurityEvents = [...openSecurityEvents]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, 3);

  const stats: OverviewStatCard[] = [
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
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-sky-400/20 bg-sky-500/[0.07] p-4 backdrop-blur-sm md:col-span-2">
            <div className="space-y-4">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">节点状态</p>
                <p className="mt-3 text-2xl font-semibold text-sky-100">{servers.length}</p>
                <p className="mt-2 text-xs text-slate-300/80">
                  {servers.length === 0
                    ? '等待节点接入'
                    : hasInternetData
                      ? `在线状态与外网探测按同一口径汇总，当前 ${internetSummary.unprobed} 个节点未探测。`
                      : '当前节点尚未上报外网探测数据。'}
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="min-w-0 rounded-2xl border border-white/10 bg-slate-950/30 p-4">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">在线状态</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="node-badge-base node-badge-status-online">在线 {connectionSummary.online}</span>
                    <span className="node-badge-base node-badge-status-offline">离线 {connectionSummary.offline}</span>
                    {connectionSummary.connecting > 0 && (
                      <span className="node-badge-base node-badge-status-connecting">连接中 {connectionSummary.connecting}</span>
                    )}
                    {connectionSummary.error > 0 && (
                      <span className="node-badge-base node-badge-status-error">异常 {connectionSummary.error}</span>
                    )}
                  </div>
                </div>
                <div className="min-w-0 rounded-2xl border border-white/10 bg-slate-950/30 p-4">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">外网状态</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="node-badge-base node-badge-status-online">有外网 {internetSummary.reachable}</span>
                    <span className="node-badge-base node-badge-status-offline">无外网 {internetSummary.unreachable}</span>
                    <span className="node-badge-base node-badge-status-neutral">未探测 {internetSummary.unprobed}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
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
