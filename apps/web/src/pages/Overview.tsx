import { useStore } from '../store/useStore.js';
import { ServerCard } from '../components/ServerCard.js';
import { getInternetReachabilityState } from '../utils/nodeStatus.js';

function formatTime(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Overview() {
  const servers = useStore((s) => s.servers);
  const statuses = useStore((s) => s.statuses);
  const latestSnapshots = useStore((s) => s.latestSnapshots);
  const securityEvents = useStore((s) => s.securityEvents);

  const connectionSummary = servers.reduce(
    (summary, server) => {
      const status = statuses.get(server.id)?.status ?? 'offline';
      if (status === 'online') summary.online += 1;
      else summary.offline += 1;
      return summary;
    },
    { online: 0, offline: 0 },
  );

  const internetSummary = servers.reduce(
    (summary, server) => {
      const snapshot = latestSnapshots.get(server.id);
      const state = getInternetReachabilityState(snapshot?.resourceSnapshot.network.internetReachable);
      if (state === 'reachable') summary.reachable += 1;
      else if (state === 'unreachable') summary.unreachable += 1;
      else summary.unprobed += 1;
      return summary;
    },
    { reachable: 0, unreachable: 0, unprobed: 0 },
  );
  const hasInternetData = servers.length > 0 && internetSummary.unprobed < servers.length;

  const queuedCount = Array.from(latestSnapshots.values()).reduce(
    (sum, snap) => sum + snap.taskQueue.queued.length, 0,
  );
  const runningCount = Array.from(latestSnapshots.values()).reduce(
    (sum, snap) => sum + snap.taskQueue.running.length, 0,
  );

  const openSecurityEvents = securityEvents.filter((e) => !e.resolved);
  const riskyNodeCount = new Set(openSecurityEvents.map((e) => e.serverId)).size;

  const latestMetricTimestamp = Array.from(latestSnapshots.values()).reduce(
    (latest, snap) => Math.max(latest, snap.timestamp), 0,
  );

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Dashboard stat cards */}
      <section>
        <div className="grid gap-3 sm:gap-3.5 md:grid-cols-2 xl:grid-cols-4">
          {/* Node status card (spans 2 cols) */}
          <div className="rounded-2xl border border-sky-400/20 bg-sky-500/[0.07] p-3.5 sm:p-4 backdrop-blur-sm md:col-span-2">
            <div className="space-y-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] sm:tracking-[0.22em] text-slate-500">节点状态</p>
                <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                  <p className="text-2xl font-semibold text-sky-100">{servers.length}</p>
                  <p className="text-xs text-slate-400 leading-5">
                    {latestMetricTimestamp > 0 ? `最近采样 ${formatTime(latestMetricTimestamp)}` : '等待第一批数据上报'}
                  </p>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-300/85">
                  {servers.length === 0
                    ? '等待节点接入'
                    : hasInternetData
                      ? `在线状态与外网探测按同一口径汇总，当前 ${internetSummary.unprobed} 个节点未探测。`
                      : '当前节点尚未上报外网探测数据。'}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="min-w-0 rounded-2xl border border-white/10 bg-slate-950/30 p-3.5">
                  <p className="text-[12px] uppercase tracking-[0.16em] sm:text-[11px] sm:tracking-[0.22em] text-slate-500">在线状态</p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <span className="node-badge-base node-badge-status-online">在线 {connectionSummary.online}</span>
                    <span className="node-badge-base node-badge-status-offline">离线 {connectionSummary.offline}</span>
                  </div>
                </div>
                <div className="min-w-0 rounded-2xl border border-white/10 bg-slate-950/30 p-3.5">
                  <p className="text-[12px] uppercase tracking-[0.16em] sm:text-[11px] sm:tracking-[0.22em] text-slate-500">外网状态</p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <span className="node-badge-base node-badge-status-online">有外网 {internetSummary.reachable}</span>
                    <span className="node-badge-base node-badge-status-offline">无外网 {internetSummary.unreachable}</span>
                    <span className="node-badge-base node-badge-status-neutral">未探测 {internetSummary.unprobed}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Task load card */}
          <div className="rounded-2xl border border-cyan-400/12 bg-cyan-500/[0.04] p-3.5 sm:p-4 backdrop-blur-sm">
            <p className="text-xs uppercase tracking-[0.18em] sm:tracking-[0.22em] text-slate-500">任务负载</p>
            <p className="mt-2.5 text-2xl font-semibold text-slate-100">{queuedCount + runningCount}</p>
            <p className="mt-1.5 text-xs leading-5 text-slate-400">排队 {queuedCount} · 运行 {runningCount}</p>
          </div>

          {/* Pending risks card */}
          <div className="rounded-2xl border border-amber-400/16 bg-amber-400/[0.05] p-3.5 sm:p-4 backdrop-blur-sm">
            <p className="text-xs uppercase tracking-[0.18em] sm:tracking-[0.22em] text-slate-500">待处理风险</p>
            <p className="mt-2.5 text-2xl font-semibold text-amber-100">{openSecurityEvents.length}</p>
            <p className="mt-1.5 text-xs leading-5 text-slate-300/85">
              {openSecurityEvents.length === 0 ? '过去 7 天未发现未处理事件' : `${riskyNodeCount} 个节点存在风险`}
            </p>
          </div>
        </div>
      </section>

      {/* Node running view */}
      <section className="space-y-3.5">
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
          <div className={`grid gap-3.5 ${
            servers.length <= 2 ? 'grid-cols-1 md:grid-cols-2' :
            servers.length <= 4 ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-2' :
            'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
          }`}>
            {servers.map((server) => (
              <ServerCard
                key={server.id}
                server={server}
                status={statuses.get(server.id)}
                report={latestSnapshots.get(server.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
