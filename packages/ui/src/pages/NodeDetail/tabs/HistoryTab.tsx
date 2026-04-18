import { useMemo } from 'react';
import { TimeSeriesChart } from '../../../components/TimeSeriesChart.js';
import type { TimeSeriesChartSeries } from '../../../components/TimeSeriesChart.js';
import type { SnapshotWithGpu } from '../../../transport/types.js';
import type { HistoryPreset, HistoryRangeQuery } from '../utils/types.js';
import { buildRateChart, buildHistoryGpuSeries, formatPercentAxis } from '../utils/chart.js';
import { computeGpuTotals } from '../utils/gpu.js';
import { describeHistoryRange } from '../utils/history.js';
import { HistoryRangeToolbar } from '../components/HistoryRangeToolbar.js';
import { GpuTrendDisclosure } from '../components/GpuTrendDisclosure.js';

interface HistoryTabProps {
  historyRange: HistoryRangeQuery;
  historySnapshots: SnapshotWithGpu[];
  historyLoading: boolean;
  customHistoryFrom: string;
  customHistoryTo: string;
  setCustomHistoryFrom: (value: string) => void;
  setCustomHistoryTo: (value: string) => void;
  applyPreset: (preset: Exclude<HistoryPreset, 'custom'>) => void;
  applyCustomRange: () => void;
  expandedGpuCharts: Record<number, boolean>;
  onToggleGpuChart: (index: number) => void;
}

export function HistoryTab({
  historyRange,
  historySnapshots,
  historyLoading,
  customHistoryFrom,
  customHistoryTo,
  setCustomHistoryFrom,
  setCustomHistoryTo,
  applyPreset,
  applyCustomRange,
  expandedGpuCharts,
  onToggleGpuChart,
}: HistoryTabProps) {
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
      name: '显存占用率',
      data: historySnapshots.map((snapshot) => ({ time: snapshot.timestamp * 1000, value: computeGpuTotals(snapshot.gpuCards).totalVramPercent })),
      color: '#ec4899',
      unit: '%',
    },
  ]), [historySnapshots]);

  const historyGpuSeries = useMemo(() => buildHistoryGpuSeries(historySnapshots), [historySnapshots]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-dark-border bg-dark-card p-4 space-y-4">
        <HistoryRangeToolbar
          activePreset={historyRange.preset}
          customFrom={customHistoryFrom}
          customTo={customHistoryTo}
          onPresetSelect={applyPreset}
          onCustomFromChange={setCustomHistoryFrom}
          onCustomToChange={setCustomHistoryTo}
          onApplyCustom={applyCustomRange}
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
              <h3 className="mb-3 text-sm font-medium text-slate-300">GPU 总利用率 / 显存占用率</h3>
              <TimeSeriesChart series={historyGpuTotalsSeries} height={180} yAxisFormatter={formatPercentAxis} yAxisMin={0} yAxisMax={100} />
            </div>
            <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-slate-300">网络 IO</h3>
                {historyNetworkChart.usesDualAxes && <span className="text-xs text-slate-500">{historyNetworkChart.unitLabel}</span>}
              </div>
              <TimeSeriesChart series={historyNetworkChart.series} height={180} yAxes={historyNetworkChart.yAxes} />
            </div>
            <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-slate-300">磁盘 IO</h3>
                {historyDiskIoChart.usesDualAxes && <span className="text-xs text-slate-500">{historyDiskIoChart.unitLabel}</span>}
              </div>
              <TimeSeriesChart series={historyDiskIoChart.series} height={180} yAxes={historyDiskIoChart.yAxes} />
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
                    onToggle={() => onToggleGpuChart(gpu.index)}
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
  );
}
