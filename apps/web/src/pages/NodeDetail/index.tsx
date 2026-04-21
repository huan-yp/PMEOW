import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../../store/useStore.js';
import { getConnectionStatusVisual, getInternetReachabilityState, getInternetStatusVisual } from '../../utils/nodeStatus.js';
import type { Tab, NodeDetailLocationState } from './utils/types.js';
import { IdentityPill } from './components/IdentityPill.js';
import { useRealtimeMetrics } from './hooks/useRealtimeMetrics.js';
import { useHistoryData } from './hooks/useHistoryData.js';
import { useSnapshotData } from './hooks/useSnapshotData.js';
import { RealtimeTab } from './tabs/RealtimeTab.js';
import { ProcessesTab } from './tabs/ProcessesTab.js';
import { HistoryTab } from './tabs/HistoryTab.js';
import { SnapshotTab } from './tabs/SnapshotTab.js';
import { TaskBrowser } from '../../components/TaskBrowser.js';

export default function NodeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const servers = useStore((s) => s.servers);
  const statuses = useStore((s) => s.statuses);
  const latestSnapshots = useStore((s) => s.latestSnapshots);

  const server = servers.find((s) => s.id === id);
  const status = id ? statuses.get(id) : undefined;
  const report = id ? latestSnapshots.get(id) : undefined;
  const returnState = location.state as NodeDetailLocationState | null;
  const backTarget = returnState?.returnTo ?? '/nodes';
  const backLabel = returnState?.returnLabel ?? '返回节点列表';

  const [tab, setTab] = useState<Tab>('realtime');
  const [expandedGpuCharts, setExpandedGpuCharts] = useState<Record<number, boolean>>({});

  // Reset shared UI state when the viewed node changes
  useEffect(() => {
    setTab('realtime');
    setExpandedGpuCharts({});
  }, [id]);

  const realtime = useRealtimeMetrics(id, report);
  const history = useHistoryData(id, tab);
  const snapshot = useSnapshotData(id, tab);

  const snap = report?.resourceSnapshot;
  const connectionVisual = getConnectionStatusVisual(status?.status ?? 'offline');
  const internetVisual = getInternetStatusVisual(getInternetReachabilityState(snap?.network.internetReachable));
  const agentLabel = server ? (server.agentId.length > 12 ? server.agentId.slice(0, 12) : server.agentId) : '';

  const handleToggleGpuChart = (index: number) => {
    setExpandedGpuCharts((prev) => ({ ...prev, [index]: !(prev[index] ?? false) }));
  };

  if (!server) {
    return (
      <div className="p-8 text-center text-slate-500">
        节点不存在。<button onClick={() => navigate('/nodes')} className="ml-2 text-accent-blue hover:underline">返回列表</button>
      </div>
    );
  }

  const tabClass = (t: Tab) =>
    `px-4 py-2 text-sm rounded-t-lg transition-colors ${tab === t ? 'bg-dark-card text-slate-100 border-b-2 border-accent-blue' : 'text-slate-500 hover:text-slate-300'}`;

  return (
    <div className="space-y-6">
      <div className={`node-surface-shell ${connectionVisual.surfaceClassName} rounded-[28px] p-5 sm:p-6`}>
        <button onClick={() => navigate(backTarget)} className="text-xs text-accent-blue hover:underline mb-2">← {backLabel}</button>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className={`node-badge-base ${connectionVisual.badgeClassName}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${connectionVisual.dotClassName}`} />
              {connectionVisual.label}
            </span>
            <span className={`node-badge-base ${internetVisual.badgeClassName}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${internetVisual.dotClassName}`} />
              {internetVisual.label}
            </span>
            <span className="node-badge-base node-badge-source-agent">Agent {agentLabel}</span>
            {status?.version && <span className="node-badge-base node-badge-status-neutral">v{status.version}</span>}
          </div>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-50 sm:text-[2.35rem]">{server.name}</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:max-w-xl">
            <IdentityPill label="节点类型" value="Agent 节点" accent="cyan" />
            <IdentityPill label="实时状态" value={snap ? '指标已接入' : '等待最新快照'} accent={snap ? 'green' : 'amber'} />
          </div>
        </div>
      </div>

      <div className="flex gap-1 border-b border-dark-border">
        <button className={tabClass('realtime')} onClick={() => setTab('realtime')}>实时概览</button>
        <button className={tabClass('processes')} onClick={() => setTab('processes')}>进程</button>
        <button className={tabClass('tasks')} onClick={() => setTab('tasks')}>任务</button>
        <button className={tabClass('history')} onClick={() => setTab('history')}>历史</button>
        <button className={tabClass('snapshot')} onClick={() => setTab('snapshot')}>快照</button>
      </div>

      {tab === 'realtime' && (
        <RealtimeTab
          snap={snap}
          report={report}
          expandedGpuCharts={expandedGpuCharts}
          onToggleGpuChart={handleToggleGpuChart}
          {...realtime}
        />
      )}

      {tab === 'processes' && (
        <ProcessesTab processes={snap?.processes ?? []} />
      )}

      {tab === 'tasks' && (
        <div className="space-y-4 rounded-2xl border border-dark-border bg-dark-card p-4">
          <div>
            <h3 className="text-sm font-medium text-slate-300">机器任务</h3>
            <p className="mt-1 text-sm text-slate-500">仅展示当前机器上的任务，可直接跳转查看任务详情。</p>
          </div>
          <TaskBrowser serverId={server.id} hideServerColumn emptyText="该机器暂无任务记录" />
        </div>
      )}

      {tab === 'history' && (
        <HistoryTab
          expandedGpuCharts={expandedGpuCharts}
          onToggleGpuChart={handleToggleGpuChart}
          {...history}
        />
      )}

      {tab === 'snapshot' && (
        <SnapshotTab
          snapshotTimeline={snapshot.snapshotTimeline}
          selectedSnapshotTs={snapshot.selectedSnapshotTs}
          selectedSnapshot={snapshot.selectedSnapshot}
          snapshotLoading={snapshot.snapshotLoading}
          onSelectSnapshot={snapshot.setSelectedSnapshotTs}
        />
      )}
    </div>
  );
}
