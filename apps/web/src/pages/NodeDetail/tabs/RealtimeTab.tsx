import { useMemo } from 'react';
import { TimeSeriesChart } from '../../../components/TimeSeriesChart.js';
import type { TimeSeriesChartSeries } from '../../../components/TimeSeriesChart.js';
import { GpuBar } from '../../../components/GpuBar.js';
import type { TaskInfo, UnifiedReport } from '../../../transport/types.js';
import type { ChartPoint, PerGpuRealtimeHistory } from '../utils/types.js';
import { buildRateChart, formatPercentAxis } from '../utils/chart.js';
import { computeGpuTotals, computeGpuMemoryUsagePercent, buildGpuAllocationLegendModel } from '../utils/gpu.js';
import { RealtimeStateSection } from '../components/RealtimeStateSection.js';
import { GpuAllocationLegend } from '../components/GpuAllocationLegend.js';
import { GpuTrendDisclosure } from '../components/GpuTrendDisclosure.js';

interface RealtimeTabProps {
  snap: UnifiedReport['resourceSnapshot'] | undefined;
  report: UnifiedReport | undefined;
  cpuHistory: ChartPoint[];
  memHistory: ChartPoint[];
  networkRxHistory: ChartPoint[];
  networkTxHistory: ChartPoint[];
  diskReadHistory: ChartPoint[];
  diskWriteHistory: ChartPoint[];
  gpuTotalUtilHistory: ChartPoint[];
  gpuTotalVramHistory: ChartPoint[];
  gpuRealtimeHistory: Record<number, PerGpuRealtimeHistory>;
  expandedGpuCharts: Record<number, boolean>;
  onToggleGpuChart: (index: number) => void;
}

export function RealtimeTab({
  snap,
  report,
  cpuHistory,
  memHistory,
  networkRxHistory,
  networkTxHistory,
  diskReadHistory,
  diskWriteHistory,
  gpuTotalUtilHistory,
  gpuTotalVramHistory,
  gpuRealtimeHistory,
  expandedGpuCharts,
  onToggleGpuChart,
}: RealtimeTabProps) {
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
    { name: '显存占用率', data: gpuTotalVramHistory, color: '#ec4899', unit: '%' },
  ]), [gpuTotalUtilHistory, gpuTotalVramHistory]);

  const realtimeGpuCards = snap?.gpuCards ?? [];
  const realtimeTasks = useMemo<TaskInfo[]>(() => {
    if (!report) return [];
    return [...report.taskQueue.running, ...report.taskQueue.queued];
  }, [report]);
  const currentGpuTotals = useMemo(() => computeGpuTotals(realtimeGpuCards), [realtimeGpuCards]);
  const realtimeGpuAllocation = useMemo(() => buildGpuAllocationLegendModel(realtimeGpuCards, realtimeTasks, false), [realtimeGpuCards, realtimeTasks]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
          <h3 className="mb-3 text-sm font-medium text-slate-300">CPU / 内存使用率</h3>
          <TimeSeriesChart series={realtimeUsageSeries} height={180} yAxisFormatter={formatPercentAxis} yAxisMin={0} yAxisMax={100} />
        </div>
        <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
          <h3 className="mb-3 text-sm font-medium text-slate-300">GPU 总利用率 / 显存占用率</h3>
          <TimeSeriesChart series={realtimeGpuTotalsSeries} height={180} yAxisFormatter={formatPercentAxis} yAxisMin={0} yAxisMax={100} />
        </div>
        <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-slate-300">网络 IO</h3>
            {realtimeNetworkChart.usesDualAxes && <span className="text-xs text-slate-500">{realtimeNetworkChart.unitLabel}</span>}
          </div>
          <TimeSeriesChart series={realtimeNetworkChart.series} height={180} yAxes={realtimeNetworkChart.yAxes} />
        </div>
        <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-slate-300">磁盘 IO</h3>
            {realtimeDiskIoChart.usesDualAxes && <span className="text-xs text-slate-500">{realtimeDiskIoChart.unitLabel}</span>}
          </div>
          <TimeSeriesChart series={realtimeDiskIoChart.series} height={180} yAxes={realtimeDiskIoChart.yAxes} />
        </div>
      </div>

      {realtimeGpuCards.length > 0 && (
        <div className="rounded-2xl border border-dark-border bg-dark-card p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-slate-300">单卡 GPU 趋势</h3>
            <span className="text-xs text-slate-500">默认折叠，展开后查看每张 GPU 的利用率、显存占用与显存带宽利用率</span>
          </div>
          <div className="space-y-3">
            {realtimeGpuCards.map((gpu) => (
              <GpuTrendDisclosure
                key={`realtime-${gpu.index}`}
                title={`GPU ${gpu.index}: ${gpu.name}`}
                subtitle={`当前 GPU ${gpu.utilizationGpu.toFixed(0)}% · 显存占用 ${computeGpuMemoryUsagePercent(gpu).toFixed(0)}% · 显存带宽利用率 ${gpu.utilizationMemory.toFixed(0)}%`}
                open={expandedGpuCharts[gpu.index] ?? false}
                onToggle={() => onToggleGpuChart(gpu.index)}
              >
                <TimeSeriesChart
                  series={[
                    { name: 'GPU 利用率', data: gpuRealtimeHistory[gpu.index]?.utilization ?? [], color: '#8b5cf6', unit: '%' },
                    { name: '显存占用', data: gpuRealtimeHistory[gpu.index]?.memoryUsage ?? [], color: '#ec4899', unit: '%' },
                    { name: '显存带宽利用率', data: gpuRealtimeHistory[gpu.index]?.memoryBandwidth ?? [], color: '#f97316', unit: '%' },
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
          {snap.gpuCards.map((gpu) => <GpuBar key={gpu.index} gpu={gpu} tasks={realtimeTasks} />)}
          <GpuAllocationLegend model={realtimeGpuAllocation} />
        </div>
      )}

      {snap && (
        <RealtimeStateSection snap={snap} gpuTotals={currentGpuTotals} />
      )}
    </div>
  );
}
