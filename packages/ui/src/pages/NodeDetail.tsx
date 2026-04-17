import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore.js';
import { useTransport } from '../transport/TransportProvider.js';
import { TimeSeriesChart } from '../components/TimeSeriesChart.js';
import type { TimeSeriesChartSeries } from '../components/TimeSeriesChart.js';
import { GpuBar } from '../components/GpuBar.js';
import { ProcessTable } from '../components/ProcessTable.js';
import { SnapshotTimePicker } from '../components/SnapshotTimePicker.js';
import type { SnapshotWithGpu } from '../transport/types.js';

type Tab = 'realtime' | 'processes' | 'history';

export default function NodeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const transport = useTransport();
  const servers = useStore((s) => s.servers);
  const statuses = useStore((s) => s.statuses);
  const latestSnapshots = useStore((s) => s.latestSnapshots);

  const server = servers.find((s) => s.id === id);
  const status = id ? statuses.get(id) : undefined;
  const report = id ? latestSnapshots.get(id) : undefined;

  const [tab, setTab] = useState<Tab>('realtime');

  // Realtime chart data buffer
  const [cpuHistory, setCpuHistory] = useState<{ time: number; value: number }[]>([]);
  const [memHistory, setMemHistory] = useState<{ time: number; value: number }[]>([]);

  useEffect(() => {
    if (!report) return;
    const now = report.timestamp * 1000;
    const cutoff = now - 10 * 60 * 1000; // keep 10 minutes
    setCpuHistory((prev) => [...prev.filter((p) => p.time > cutoff), { time: now, value: report.resourceSnapshot.cpu.usage }]);
    setMemHistory((prev) => [...prev.filter((p) => p.time > cutoff), { time: now, value: report.resourceSnapshot.memory.percent }]);
  }, [report]);

  // History tab
  const [historySnapshots, setHistorySnapshots] = useState<SnapshotWithGpu[]>([]);
  const [selectedTs, setSelectedTs] = useState<number | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!id) return;
    setHistoryLoading(true);
    try {
      const res = await transport.getMetricsHistory(id, {});
      setHistorySnapshots(res.snapshots);
      if (res.snapshots.length > 0) setSelectedTs(res.snapshots[res.snapshots.length - 1].timestamp);
    } catch { /* ignore */ }
    setHistoryLoading(false);
  }, [id, transport]);

  useEffect(() => {
    if (tab === 'history') loadHistory();
  }, [tab, loadHistory]);

  const selectedSnapshot = useMemo(
    () => historySnapshots.find((s) => s.timestamp === selectedTs),
    [historySnapshots, selectedTs],
  );

  if (!server) {
    return (
      <div className="p-8 text-center text-slate-500">
        节点不存在。<button onClick={() => navigate('/nodes')} className="ml-2 text-accent-blue hover:underline">返回列表</button>
      </div>
    );
  }

  const tabClass = (t: Tab) =>
    `px-4 py-2 text-sm rounded-t-lg transition-colors ${tab === t ? 'bg-dark-card text-slate-100 border-b-2 border-accent-blue' : 'text-slate-500 hover:text-slate-300'}`;

  const snap = report?.resourceSnapshot;

  return (
    <div className="space-y-6">
      <div>
        <button onClick={() => navigate('/nodes')} className="text-xs text-accent-blue hover:underline mb-2">← 返回节点列表</button>
        <h2 className="text-xl font-bold text-slate-100">{server.name}</h2>
        <p className="text-sm text-slate-500">
          {status?.status === 'online' ? '🟢 在线' : '🔴 离线'}
          {status?.version ? ` · v${status.version}` : ''}
        </p>
      </div>

      <div className="flex gap-1 border-b border-dark-border">
        <button className={tabClass('realtime')} onClick={() => setTab('realtime')}>实时概览</button>
        <button className={tabClass('processes')} onClick={() => setTab('processes')}>进程</button>
        <button className={tabClass('history')} onClick={() => setTab('history')}>历史</button>
      </div>

      {tab === 'realtime' && (
        <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
              <h3 className="mb-3 text-sm font-medium text-slate-300">CPU 使用率</h3>
              <TimeSeriesChart series={[{ name: 'CPU', data: cpuHistory, color: '#3b82f6', unit: '%' }]} height={180} />
            </div>
            <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
              <h3 className="mb-3 text-sm font-medium text-slate-300">内存使用率</h3>
              <TimeSeriesChart series={[{ name: '内存', data: memHistory, color: '#10b981', unit: '%' }]} height={180} />
            </div>
          </div>

          {snap && snap.gpuCards.length > 0 && (
            <div className="rounded-2xl border border-dark-border bg-dark-card p-4 space-y-4">
              <h3 className="text-sm font-medium text-slate-300">GPU 显存分配</h3>
              {snap.gpuCards.map((gpu) => <GpuBar key={gpu.index} gpu={gpu} />)}
            </div>
          )}

          {snap && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="CPU" value={`${snap.cpu.usage.toFixed(1)}%`} sub={`${snap.cpu.cores} 核 ${snap.cpu.frequency} MHz`} />
              <StatCard label="内存" value={`${snap.memory.percent.toFixed(1)}%`} sub={`${(snap.memory.usedMb / 1024).toFixed(1)} / ${(snap.memory.totalMb / 1024).toFixed(1)} GB`} />
              <StatCard label="磁盘" value={snap.disks[0] ? `${((snap.disks[0].usedMb / snap.disks[0].totalMb) * 100).toFixed(0)}%` : 'N/A'} sub={snap.disks[0]?.mountpoint ?? ''} />
              <StatCard label="网络" value={`↓${fmtRate(snap.network)} ↑${fmtRateTx(snap.network)}`} sub={`${snap.network.length} 接口`} />
            </div>
          )}
        </div>
      )}

      {tab === 'processes' && (
        <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
          <ProcessTable processes={snap?.processes ?? []} />
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-4">
          {historyLoading ? (
            <div className="text-center text-sm text-slate-500 py-8">加载中...</div>
          ) : (
            <>
              <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
                <SnapshotTimePicker
                  snapshots={historySnapshots}
                  selectedTimestamp={selectedTs}
                  onSelect={setSelectedTs}
                />
              </div>
              {selectedSnapshot && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <StatCard label="CPU" value={`${selectedSnapshot.cpu.usage.toFixed(1)}%`} sub={`${selectedSnapshot.cpu.cores} 核`} />
                  <StatCard label="内存" value={`${selectedSnapshot.memory.percent.toFixed(1)}%`} sub={`${(selectedSnapshot.memory.usedMb / 1024).toFixed(1)} GB 已用`} />
                  <StatCard label="进程数" value={`${selectedSnapshot.processes.length}`} sub="快照时刻" />
                  <StatCard label="GPU" value={`${selectedSnapshot.gpuCards.length} 卡`} sub="" />
                </div>
              )}
              {selectedSnapshot && (
                <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
                  <h3 className="mb-3 text-sm font-medium text-slate-300">快照进程列表</h3>
                  <ProcessTable processes={selectedSnapshot.processes} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-mono font-semibold text-slate-100">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function fmtRate(network: { interface: string; rxBytesPerSec: number; txBytesPerSec: number }[]): string {
  const total = network.reduce((s, n) => s + n.rxBytesPerSec, 0);
  if (total > 1_000_000) return `${(total / 1_000_000).toFixed(1)} MB/s`;
  if (total > 1_000) return `${(total / 1_000).toFixed(1)} KB/s`;
  return `${total} B/s`;
}

function fmtRateTx(network: { interface: string; rxBytesPerSec: number; txBytesPerSec: number }[]): string {
  const total = network.reduce((s, n) => s + n.txBytesPerSec, 0);
  if (total > 1_000_000) return `${(total / 1_000_000).toFixed(1)} MB/s`;
  if (total > 1_000) return `${(total / 1_000).toFixed(1)} KB/s`;
  return `${total} B/s`;
}
