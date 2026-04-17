import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore.js';
import { useTransport } from '../transport/TransportProvider.js';
import { TimeSeriesChart } from '../components/TimeSeriesChart.js';
import type { TimeSeriesChartSeries } from '../components/TimeSeriesChart.js';
import { GpuBar } from '../components/GpuBar.js';
import { ProcessTable } from '../components/ProcessTable.js';
import { SnapshotTimePicker } from '../components/SnapshotTimePicker.js';
import type { SnapshotWithGpu, UnifiedReport } from '../transport/types.js';
import { formatBytesPerSecond } from '../utils/rates.js';

type Tab = 'realtime' | 'processes' | 'history' | 'snapshot';
type ChartPoint = { time: number; value: number };
type HistoryPreset = '24h' | '3d' | '7d' | '30d' | 'custom';

interface NodeDetailLocationState {
  returnTo?: string;
  returnLabel?: string;
}

interface HistoryRangeQuery {
  preset: HistoryPreset;
  from: number;
  to: number;
}

interface PerGpuRealtimeHistory {
  utilization: ChartPoint[];
  vram: ChartPoint[];
}

const REALTIME_WINDOW_SECONDS = 10 * 60;
const SNAPSHOT_TIMELINE_FROM = 0;

const PRESET_LABELS: Record<Exclude<HistoryPreset, 'custom'>, string> = {
  '24h': '24 小时',
  '3d': '3 天',
  '7d': '7 天',
  '30d': '30 天',
};

export default function NodeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const transport = useTransport();
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

  const [cpuHistory, setCpuHistory] = useState<ChartPoint[]>([]);
  const [memHistory, setMemHistory] = useState<ChartPoint[]>([]);
  const [networkRxHistory, setNetworkRxHistory] = useState<ChartPoint[]>([]);
  const [networkTxHistory, setNetworkTxHistory] = useState<ChartPoint[]>([]);
  const [diskReadHistory, setDiskReadHistory] = useState<ChartPoint[]>([]);
  const [diskWriteHistory, setDiskWriteHistory] = useState<ChartPoint[]>([]);
  const [gpuTotalUtilHistory, setGpuTotalUtilHistory] = useState<ChartPoint[]>([]);
  const [gpuTotalVramHistory, setGpuTotalVramHistory] = useState<ChartPoint[]>([]);
  const [gpuRealtimeHistory, setGpuRealtimeHistory] = useState<Record<number, PerGpuRealtimeHistory>>({});
  const [expandedGpuCharts, setExpandedGpuCharts] = useState<Record<number, boolean>>({});

  const [historyRange, setHistoryRange] = useState<HistoryRangeQuery>(() => buildPresetRange('24h'));
  const [customHistoryFrom, setCustomHistoryFrom] = useState(() => formatDateTimeLocal(buildPresetRange('24h').from));
  const [customHistoryTo, setCustomHistoryTo] = useState(() => formatDateTimeLocal(buildPresetRange('24h').to));

  useEffect(() => {
    setCpuHistory([]);
    setMemHistory([]);
    setNetworkRxHistory([]);
    setNetworkTxHistory([]);
    setDiskReadHistory([]);
    setDiskWriteHistory([]);
    setGpuTotalUtilHistory([]);
    setGpuTotalVramHistory([]);
    setGpuRealtimeHistory({});
    setExpandedGpuCharts({});
    setHistoryRange(buildPresetRange('24h'));
    setCustomHistoryFrom(formatDateTimeLocal(buildPresetRange('24h').from));
    setCustomHistoryTo(formatDateTimeLocal(buildPresetRange('24h').to));
    setHistorySnapshots([]);
    setSnapshotTimeline([]);
    setSelectedSnapshotTs(null);
    setTab('realtime');
  }, [id]);

  useEffect(() => {
    if (!report) return;
    const now = report.timestamp * 1000;
    const cutoff = now - REALTIME_WINDOW_SECONDS * 1000;
    const totals = computeGpuTotals(report.resourceSnapshot.gpuCards);

    setCpuHistory((prev) => appendChartPoint(prev, now, report.resourceSnapshot.cpu.usagePercent, cutoff));
    setMemHistory((prev) => appendChartPoint(prev, now, report.resourceSnapshot.memory.usagePercent, cutoff));
    setNetworkRxHistory((prev) => appendChartPoint(prev, now, report.resourceSnapshot.network.rxBytesPerSec, cutoff));
    setNetworkTxHistory((prev) => appendChartPoint(prev, now, report.resourceSnapshot.network.txBytesPerSec, cutoff));
    setDiskReadHistory((prev) => appendChartPoint(prev, now, report.resourceSnapshot.diskIo.readBytesPerSec, cutoff));
    setDiskWriteHistory((prev) => appendChartPoint(prev, now, report.resourceSnapshot.diskIo.writeBytesPerSec, cutoff));
    setGpuTotalUtilHistory((prev) => appendChartPoint(prev, now, totals.averageUtilization, cutoff));
    setGpuTotalVramHistory((prev) => appendChartPoint(prev, now, totals.totalVramPercent, cutoff));
    setGpuRealtimeHistory((prev) => {
      const next: Record<number, PerGpuRealtimeHistory> = {};
      for (const gpu of report.resourceSnapshot.gpuCards) {
        const current = prev[gpu.index] ?? { utilization: [], vram: [] };
        next[gpu.index] = {
          utilization: appendChartPoint(current.utilization, now, gpu.utilizationGpu, cutoff),
          vram: appendChartPoint(current.vram, now, gpu.utilizationMemory, cutoff),
        };
      }
      return next;
    });
  }, [report]);

  const [historySnapshots, setHistorySnapshots] = useState<SnapshotWithGpu[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [snapshotTimeline, setSnapshotTimeline] = useState<SnapshotWithGpu[]>([]);
  const [selectedSnapshotTs, setSelectedSnapshotTs] = useState<number | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  const loadHistory = useCallback(async (query: Pick<HistoryRangeQuery, 'from' | 'to'>) => {
    if (!id) return;
    setHistoryLoading(true);
    try {
      const res = await transport.getMetricsHistory(id, query);
      setHistorySnapshots(res.snapshots);
    } catch { /* ignore */ }
    setHistoryLoading(false);
  }, [id, transport]);

  useEffect(() => {
    if (tab === 'history') {
      void loadHistory({ from: historyRange.from, to: historyRange.to });
    }
  }, [tab, historyRange, loadHistory]);

  const loadSnapshotTimeline = useCallback(async () => {
    if (!id) return;
    setSnapshotLoading(true);
    try {
      const res = await transport.getMetricsHistory(id, {
        from: SNAPSHOT_TIMELINE_FROM,
        to: Math.floor(Date.now() / 1000),
      });
      setSnapshotTimeline(res.snapshots);
      setSelectedSnapshotTs((current) => current ?? res.snapshots[res.snapshots.length - 1]?.timestamp ?? null);
    } catch {
      setSnapshotTimeline([]);
    }
    setSnapshotLoading(false);
  }, [id, transport]);

  useEffect(() => {
    if (tab === 'snapshot') {
      void loadSnapshotTimeline();
    }
  }, [tab, loadSnapshotTimeline]);

  const selectedSnapshot = useMemo(() => {
    if (snapshotTimeline.length === 0) return undefined;
    if (selectedSnapshotTs == null) return snapshotTimeline[snapshotTimeline.length - 1];
    return snapshotTimeline.find((s) => s.timestamp === selectedSnapshotTs);
  }, [snapshotTimeline, selectedSnapshotTs]);

  const realtimeUsageSeries = useMemo<TimeSeriesChartSeries[]>(() => ([
    { name: 'CPU', data: cpuHistory, color: '#3b82f6', unit: '%' },
    { name: '内存', data: memHistory, color: '#10b981', unit: '%' },
  ]), [cpuHistory, memHistory]);

  const realtimeNetworkChart = useMemo(() => buildRateChart([
    { name: '接收', data: networkRxHistory, color: '#0ea5e9' },
    { name: '发送', data: networkTxHistory, color: '#22c55e' },
  ]), [networkRxHistory, networkTxHistory]);

  const realtimeDiskIoChart = useMemo(() => buildRateChart([
    { name: '读取', data: diskReadHistory, color: '#f59e0b' },
    { name: '写入', data: diskWriteHistory, color: '#ef4444' },
  ]), [diskReadHistory, diskWriteHistory]);

  const realtimeGpuTotalsSeries = useMemo<TimeSeriesChartSeries[]>(() => ([
    { name: 'GPU 利用率', data: gpuTotalUtilHistory, color: '#8b5cf6', unit: '%' },
    { name: 'VRAM 利用率', data: gpuTotalVramHistory, color: '#ec4899', unit: '%' },
  ]), [gpuTotalUtilHistory, gpuTotalVramHistory]);

  const historyUsageSeries = useMemo<TimeSeriesChartSeries[]>(() => ([
    { name: 'CPU', data: historySnapshots.map((snapshot) => ({ time: snapshot.timestamp * 1000, value: snapshot.cpu.usagePercent })), color: '#3b82f6', unit: '%' },
    { name: '内存', data: historySnapshots.map((snapshot) => ({ time: snapshot.timestamp * 1000, value: snapshot.memory.usagePercent })), color: '#10b981', unit: '%' },
  ]), [historySnapshots]);

  const historyNetworkChart = useMemo(() => buildRateChart([
    { name: '接收', data: historySnapshots.map((snapshot) => ({ time: snapshot.timestamp * 1000, value: snapshot.network.rxBytesPerSec })), color: '#0ea5e9' },
    { name: '发送', data: historySnapshots.map((snapshot) => ({ time: snapshot.timestamp * 1000, value: snapshot.network.txBytesPerSec })), color: '#22c55e' },
  ]), [historySnapshots]);

  const historyDiskIoChart = useMemo(() => buildRateChart([
    { name: '读取', data: historySnapshots.map((snapshot) => ({ time: snapshot.timestamp * 1000, value: snapshot.diskIo.readBytesPerSec })), color: '#f59e0b' },
    { name: '写入', data: historySnapshots.map((snapshot) => ({ time: snapshot.timestamp * 1000, value: snapshot.diskIo.writeBytesPerSec })), color: '#ef4444' },
  ]), [historySnapshots]);

  const historyGpuTotalsSeries = useMemo<TimeSeriesChartSeries[]>(() => ([
    {
      name: 'GPU 利用率',
      data: historySnapshots.map((snapshot) => ({ time: snapshot.timestamp * 1000, value: computeGpuTotals(snapshot.gpuCards).averageUtilization })),
      color: '#8b5cf6',
      unit: '%',
    },
    {
      name: 'VRAM 利用率',
      data: historySnapshots.map((snapshot) => ({ time: snapshot.timestamp * 1000, value: computeGpuTotals(snapshot.gpuCards).totalVramPercent })),
      color: '#ec4899',
      unit: '%',
    },
  ]), [historySnapshots]);

  const historyGpuSeries = useMemo(() => buildHistoryGpuSeries(historySnapshots), [historySnapshots]);

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
  const realtimeGpuCards = snap?.gpuCards ?? [];
  const currentGpuTotals = useMemo(() => computeGpuTotals(realtimeGpuCards), [realtimeGpuCards]);

  return (
    <div className="space-y-6">
      <div>
        <button onClick={() => navigate(backTarget)} className="text-xs text-accent-blue hover:underline mb-2">← {backLabel}</button>
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
        <button className={tabClass('snapshot')} onClick={() => setTab('snapshot')}>快照</button>
      </div>

      {tab === 'realtime' && (
        <div className="space-y-6">
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
              <h3 className="mb-3 text-sm font-medium text-slate-300">CPU / 内存使用率</h3>
              <TimeSeriesChart series={realtimeUsageSeries} height={180} yAxisFormatter={formatPercentAxis} yAxisMin={0} yAxisMax={100} />
            </div>
            <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
              <h3 className="mb-3 text-sm font-medium text-slate-300">GPU 总利用率 / VRAM 总利用率</h3>
              <TimeSeriesChart series={realtimeGpuTotalsSeries} height={180} yAxisFormatter={formatPercentAxis} yAxisMin={0} yAxisMax={100} />
            </div>
            <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
              <h3 className="mb-3 text-sm font-medium text-slate-300">网络 IO</h3>
              <TimeSeriesChart series={realtimeNetworkChart.series} height={180} yAxisFormatter={realtimeNetworkChart.yAxisFormatter} />
            </div>
            <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
              <h3 className="mb-3 text-sm font-medium text-slate-300">磁盘 IO</h3>
              <TimeSeriesChart series={realtimeDiskIoChart.series} height={180} yAxisFormatter={realtimeDiskIoChart.yAxisFormatter} />
            </div>
          </div>

          {realtimeGpuCards.length > 0 && (
            <div className="rounded-2xl border border-dark-border bg-dark-card p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-slate-300">单卡 GPU 趋势</h3>
                <span className="text-xs text-slate-500">默认折叠，展开后查看每张 GPU 的利用率与显存利用率</span>
              </div>
              <div className="space-y-3">
                {realtimeGpuCards.map((gpu) => (
                  <GpuTrendDisclosure
                    key={`realtime-${gpu.index}`}
                    title={`GPU ${gpu.index}: ${gpu.name}`}
                    subtitle={`当前 GPU ${gpu.utilizationGpu.toFixed(0)}% · VRAM ${gpu.utilizationMemory.toFixed(0)}%`}
                    open={expandedGpuCharts[gpu.index] ?? false}
                    onToggle={() => setExpandedGpuCharts((prev) => ({ ...prev, [gpu.index]: !(prev[gpu.index] ?? false) }))}
                  >
                    <TimeSeriesChart
                      series={[
                        { name: 'GPU 利用率', data: gpuRealtimeHistory[gpu.index]?.utilization ?? [], color: '#8b5cf6', unit: '%' },
                        { name: 'VRAM 利用率', data: gpuRealtimeHistory[gpu.index]?.vram ?? [], color: '#ec4899', unit: '%' },
                      ]}
                      height={180}
                      yAxisFormatter={formatPercentAxis}
                      yAxisMin={0}
                      yAxisMax={100}
                    />
                  </GpuTrendDisclosure>
                ))}
              </div>
            </div>
          )}

          {snap && snap.gpuCards.length > 0 && (
            <div className="rounded-2xl border border-dark-border bg-dark-card p-4 space-y-4">
              <h3 className="text-sm font-medium text-slate-300">GPU 显存分配</h3>
              {snap.gpuCards.map((gpu) => <GpuBar key={gpu.index} gpu={gpu} />)}
            </div>
          )}

          {snap && (
            <RealtimeStateSection snap={snap} gpuTotals={currentGpuTotals} />
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
          <div className="rounded-2xl border border-dark-border bg-dark-card p-4 space-y-4">
            <HistoryRangeToolbar
              activePreset={historyRange.preset}
              customFrom={customHistoryFrom}
              customTo={customHistoryTo}
              onPresetSelect={(preset) => {
                const next = buildPresetRange(preset);
                setHistoryRange(next);
                setCustomHistoryFrom(formatDateTimeLocal(next.from));
                setCustomHistoryTo(formatDateTimeLocal(next.to));
              }}
              onCustomFromChange={setCustomHistoryFrom}
              onCustomToChange={setCustomHistoryTo}
              onApplyCustom={() => {
                const from = parseDateTimeLocal(customHistoryFrom);
                const to = parseDateTimeLocal(customHistoryTo);
                if (from == null || to == null || from >= to) return;
                setHistoryRange({ preset: 'custom', from, to });
              }}
            />
            <div className="text-xs text-slate-500">
              当前范围：{describeHistoryRange(historyRange)}
            </div>
          </div>

          {historyLoading ? (
            <div className="text-center text-sm text-slate-500 py-8">加载中...</div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
                  <h3 className="mb-3 text-sm font-medium text-slate-300">CPU / 内存使用率</h3>
                  <TimeSeriesChart series={historyUsageSeries} height={180} yAxisFormatter={formatPercentAxis} yAxisMin={0} yAxisMax={100} />
                </div>
                <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
                  <h3 className="mb-3 text-sm font-medium text-slate-300">GPU 总利用率 / VRAM 总利用率</h3>
                  <TimeSeriesChart series={historyGpuTotalsSeries} height={180} yAxisFormatter={formatPercentAxis} yAxisMin={0} yAxisMax={100} />
                </div>
                <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
                  <h3 className="mb-3 text-sm font-medium text-slate-300">网络 IO</h3>
                  <TimeSeriesChart series={historyNetworkChart.series} height={180} yAxisFormatter={historyNetworkChart.yAxisFormatter} />
                </div>
                <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
                  <h3 className="mb-3 text-sm font-medium text-slate-300">磁盘 IO</h3>
                  <TimeSeriesChart series={historyDiskIoChart.series} height={180} yAxisFormatter={historyDiskIoChart.yAxisFormatter} />
                </div>
              </div>

              {historyGpuSeries.length > 0 && (
                <div className="rounded-2xl border border-dark-border bg-dark-card p-4 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-medium text-slate-300">单卡 GPU 历史</h3>
                    <span className="text-xs text-slate-500">默认折叠，展开后查看每张 GPU 的历史曲线</span>
                  </div>
                  <div className="space-y-3">
                    {historyGpuSeries.map((gpu) => (
                      <GpuTrendDisclosure
                        key={`history-${gpu.index}`}
                        title={`GPU ${gpu.index}`}
                        subtitle={gpu.label}
                        open={expandedGpuCharts[gpu.index] ?? false}
                        onToggle={() => setExpandedGpuCharts((prev) => ({ ...prev, [gpu.index]: !(prev[gpu.index] ?? false) }))}
                      >
                        <TimeSeriesChart
                          series={gpu.series}
                          height={180}
                          yAxisFormatter={formatPercentAxis}
                          yAxisMin={0}
                          yAxisMax={100}
                        />
                      </GpuTrendDisclosure>
                    ))}
                  </div>
                </div>
              )}

              {historySnapshots.length === 0 && (
                <div className="rounded-2xl border border-dark-border bg-dark-card px-4 py-8 text-center text-sm text-slate-500">
                  当前时间范围内没有历史快照。
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'snapshot' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
            {snapshotLoading ? (
              <div className="text-center text-sm text-slate-500 py-8">加载中...</div>
            ) : (
              <SnapshotTimePicker
                snapshots={snapshotTimeline}
                selectedTimestamp={selectedSnapshotTs}
                onSelect={setSelectedSnapshotTs}
              />
            )}
          </div>

          {selectedSnapshot ? (
            <>
              <SnapshotSummary snapshot={selectedSnapshot} />
              {selectedSnapshot.gpuCards.length > 0 && (
                <div className="rounded-2xl border border-dark-border bg-dark-card p-4 space-y-4">
                  <h3 className="text-sm font-medium text-slate-300">GPU 显存分配</h3>
                  {selectedSnapshot.gpuCards.map((gpu) => <GpuBar key={`snapshot-${gpu.index}`} gpu={gpu} />)}
                </div>
              )}
              <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
                <h3 className="mb-3 text-sm font-medium text-slate-300">快照进程列表</h3>
                <ProcessTable processes={selectedSnapshot.processes} />
              </div>
            </>
          ) : (
            !snapshotLoading && (
              <div className="rounded-2xl border border-dark-border bg-dark-card px-4 py-8 text-center text-sm text-slate-500">
                暂无可回放的历史快照。
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

function RealtimeStateSection({ snap, gpuTotals }: { snap: UnifiedReport['resourceSnapshot']; gpuTotals: ReturnType<typeof computeGpuTotals> }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="CPU" value={`${snap.cpu.usagePercent.toFixed(1)}%`} sub={`${snap.cpu.coreCount} 核 ${snap.cpu.frequencyMhz} MHz`} />
        <StatCard label="内存" value={`${snap.memory.usagePercent.toFixed(1)}%`} sub={`${(snap.memory.usedMb / 1024).toFixed(1)} / ${(snap.memory.totalMb / 1024).toFixed(1)} GB`} />
        <StatCard label="网络" value={`↓${formatBytesPerSecond(snap.network.rxBytesPerSec)} ↑${formatBytesPerSecond(snap.network.txBytesPerSec)}`} sub={`${snap.network.interfaces.length} 接口`} />
        <StatCard label="GPU 总览" value={`${gpuTotals.averageUtilization.toFixed(1)}%`} sub={`VRAM ${gpuTotals.totalVramPercent.toFixed(1)}%`} />
      </div>
      <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
        <h3 className="mb-3 text-sm font-medium text-slate-300">磁盘使用情况</h3>
        <DiskUsageBars disks={snap.disks} />
      </div>
    </div>
  );
}

function SnapshotSummary({ snapshot }: { snapshot: SnapshotWithGpu }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="CPU" value={`${snapshot.cpu.usagePercent.toFixed(1)}%`} sub={`${snapshot.cpu.coreCount} 核`} />
        <StatCard label="内存" value={`${snapshot.memory.usagePercent.toFixed(1)}%`} sub={`${(snapshot.memory.usedMb / 1024).toFixed(1)} GB 已用`} />
        <StatCard label="网络" value={`↓${formatBytesPerSecond(snapshot.network.rxBytesPerSec)} ↑${formatBytesPerSecond(snapshot.network.txBytesPerSec)}`} sub={`${snapshot.network.interfaces.length} 接口`} />
        <StatCard label="GPU" value={`${snapshot.gpuCards.length} 卡`} sub={`${snapshot.processes.length} 个进程`} />
      </div>
      <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
        <h3 className="mb-3 text-sm font-medium text-slate-300">磁盘使用情况</h3>
        <DiskUsageBars disks={snapshot.disks} />
      </div>
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

function DiskUsageBars({ disks }: { disks: SnapshotWithGpu['disks'] }) {
  if (disks.length === 0) {
    return <div className="text-sm text-slate-500">暂无磁盘数据</div>;
  }

  return (
    <div className="space-y-3">
      {disks.map((disk) => (
        <div key={`${disk.filesystem}-${disk.mountPoint}`} className="space-y-1.5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-slate-200">{disk.mountPoint}</span>
            <span className="text-xs text-slate-500">{disk.usedGB.toFixed(1)} / {disk.totalGB.toFixed(1)} GB</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-dark-bg">
            <div
              className={`h-full rounded-full ${disk.usagePercent >= 90 ? 'bg-accent-red' : disk.usagePercent >= 70 ? 'bg-accent-yellow' : 'bg-accent-green'}`}
              style={{ width: `${Math.max(0, Math.min(100, disk.usagePercent))}%` }}
            />
          </div>
          <div className="text-xs text-slate-500">{disk.filesystem} · {disk.usagePercent.toFixed(1)}%</div>
        </div>
      ))}
    </div>
  );
}

function HistoryRangeToolbar(props: {
  activePreset: HistoryPreset;
  customFrom: string;
  customTo: string;
  onPresetSelect: (preset: Exclude<HistoryPreset, 'custom'>) => void;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
  onApplyCustom: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {Object.entries(PRESET_LABELS).map(([preset, label]) => (
          <button
            key={preset}
            type="button"
            onClick={() => props.onPresetSelect(preset as Exclude<HistoryPreset, 'custom'>)}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${props.activePreset === preset ? 'border-accent-blue bg-accent-blue/10 text-accent-blue' : 'border-dark-border bg-dark-card text-slate-300 hover:text-slate-100'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
        <input
          type="datetime-local"
          value={props.customFrom}
          onChange={(e) => props.onCustomFromChange(e.target.value)}
          className="rounded-xl border border-dark-border bg-dark-bg px-3 py-2 text-sm text-slate-200 outline-none"
        />
        <input
          type="datetime-local"
          value={props.customTo}
          onChange={(e) => props.onCustomToChange(e.target.value)}
          className="rounded-xl border border-dark-border bg-dark-bg px-3 py-2 text-sm text-slate-200 outline-none"
        />
        <button
          type="button"
          onClick={props.onApplyCustom}
          className="rounded-xl border border-dark-border bg-dark-bg px-4 py-2 text-sm text-slate-200 hover:text-slate-100"
        >
          应用自定义范围
        </button>
      </div>
    </div>
  );
}

function GpuTrendDisclosure(props: {
  title: string;
  subtitle: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dark-border bg-dark-bg/60">
      <button
        type="button"
        onClick={props.onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <div className="text-sm font-medium text-slate-200">{props.title}</div>
          <div className="text-xs text-slate-500">{props.subtitle}</div>
        </div>
        <span className="text-xs text-slate-400">{props.open ? '收起' : '展开'}</span>
      </button>
      {props.open && <div className="border-t border-dark-border px-4 py-4">{props.children}</div>}
    </div>
  );
}

function appendChartPoint(history: ChartPoint[], time: number, value: number, cutoff: number): ChartPoint[] {
  return [...history.filter((point) => point.time > cutoff), { time, value }];
}

function computeGpuTotals(gpuCards: SnapshotWithGpu['gpuCards']) {
  if (gpuCards.length === 0) {
    return { averageUtilization: 0, totalVramPercent: 0 };
  }

  const totalUtilization = gpuCards.reduce((sum, gpu) => sum + gpu.utilizationGpu, 0);
  const totalMemory = gpuCards.reduce((sum, gpu) => sum + gpu.memoryTotalMb, 0);
  const usedMemory = gpuCards.reduce((sum, gpu) => sum + gpu.memoryUsedMb, 0);

  return {
    averageUtilization: totalUtilization / gpuCards.length,
    totalVramPercent: totalMemory > 0 ? (usedMemory / totalMemory) * 100 : 0,
  };
}

function buildRateChart(seriesList: Array<{ name: string; data: ChartPoint[]; color: string }>) {
  const maxValue = Math.max(0, ...seriesList.flatMap((series) => series.data.map((point) => point.value)));
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s'] as const;
  let divisor = 1;
  let unitIndex = 0;

  while (maxValue / divisor >= 1024 && unitIndex < units.length - 1) {
    divisor *= 1024;
    unitIndex += 1;
  }

  const unit = units[unitIndex];

  return {
    series: seriesList.map<TimeSeriesChartSeries>((series) => ({
      name: series.name,
      color: series.color,
      unit,
      data: series.data.map((point) => ({ time: point.time, value: point.value / divisor })),
    })),
    yAxisFormatter: (value: number) => formatRateAxis(value, unit),
  };
}

function buildHistoryGpuSeries(snapshots: SnapshotWithGpu[]) {
  const seriesByGpu = new Map<number, { label: string; utilization: ChartPoint[]; vram: ChartPoint[] }>();

  for (const snapshot of snapshots) {
    for (const gpu of snapshot.gpuCards) {
      const entry = seriesByGpu.get(gpu.index) ?? {
        label: `${gpu.name}`,
        utilization: [],
        vram: [],
      };
      entry.label = `${gpu.name} · GPU ${gpu.utilizationGpu.toFixed(0)}% · VRAM ${gpu.utilizationMemory.toFixed(0)}%`;
      entry.utilization.push({ time: snapshot.timestamp * 1000, value: gpu.utilizationGpu });
      entry.vram.push({ time: snapshot.timestamp * 1000, value: gpu.utilizationMemory });
      seriesByGpu.set(gpu.index, entry);
    }
  }

  return Array.from(seriesByGpu.entries()).map(([index, entry]) => ({
    index,
    label: entry.label,
    series: [
      { name: 'GPU 利用率', data: entry.utilization, color: '#8b5cf6', unit: '%' },
      { name: 'VRAM 利用率', data: entry.vram, color: '#ec4899', unit: '%' },
    ] satisfies TimeSeriesChartSeries[],
  }));
}

function buildPresetRange(preset: Exclude<HistoryPreset, 'custom'>): HistoryRangeQuery {
  const now = Math.floor(Date.now() / 1000);
  const durations: Record<Exclude<HistoryPreset, 'custom'>, number> = {
    '24h': 24 * 60 * 60,
    '3d': 3 * 24 * 60 * 60,
    '7d': 7 * 24 * 60 * 60,
    '30d': 30 * 24 * 60 * 60,
  };

  return {
    preset,
    from: now - durations[preset],
    to: now,
  };
}

function formatDateTimeLocal(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function parseDateTimeLocal(value: string): number | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor(parsed.getTime() / 1000);
}

function describeHistoryRange(range: HistoryRangeQuery): string {
  if (range.preset !== 'custom') {
    return PRESET_LABELS[range.preset];
  }
  return `${formatSnapshotTime(range.from)} - ${formatSnapshotTime(range.to)}`;
}

function formatPercentAxis(value: number): string {
  return `${value.toFixed(0)}%`;
}

function formatRateAxis(value: number, unit: string): string {
  const digits = value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${unit}`;
}

function formatSnapshotTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
