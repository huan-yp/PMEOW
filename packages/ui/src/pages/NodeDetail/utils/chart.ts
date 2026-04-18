import type { TimeSeriesChartSeries } from '../../../components/TimeSeriesChart.js';
import type { SnapshotWithGpu } from '../../../transport/types.js';
import { buildAdaptiveRateChart } from '../../../utils/rates.js';
import type { ChartPoint } from './types.js';
import { computeGpuMemoryUsagePercent } from './gpu.js';

export function appendChartPoint(history: ChartPoint[], time: number, value: number, cutoff: number): ChartPoint[] {
  const filtered = history.filter((point) => point.time > cutoff && point.time !== time);
  filtered.push({ time, value });
  return filtered;
}

export function buildRateChart(seriesList: Array<{ name: string; data: ChartPoint[]; color: string }>) {
  return buildAdaptiveRateChart(seriesList);
}

export function buildHistoryGpuSeries(snapshots: SnapshotWithGpu[]) {
  const seriesByGpu = new Map<number, {
    label: string;
    utilization: ChartPoint[];
    memoryUsage: ChartPoint[];
    memoryBandwidth: ChartPoint[];
  }>();

  for (const snapshot of snapshots) {
    for (const gpu of snapshot.gpuCards) {
      const entry = seriesByGpu.get(gpu.index) ?? {
        label: `${gpu.name}`,
        utilization: [],
        memoryUsage: [],
        memoryBandwidth: [],
      };
      entry.label = `${gpu.name} · GPU ${gpu.utilizationGpu.toFixed(0)}% · 显存占用 ${computeGpuMemoryUsagePercent(gpu).toFixed(0)}% · 显存带宽利用率 ${gpu.utilizationMemory.toFixed(0)}%`;
      entry.utilization.push({ time: snapshot.timestamp * 1000, value: gpu.utilizationGpu });
      entry.memoryUsage.push({ time: snapshot.timestamp * 1000, value: computeGpuMemoryUsagePercent(gpu) });
      entry.memoryBandwidth.push({ time: snapshot.timestamp * 1000, value: gpu.utilizationMemory });
      seriesByGpu.set(gpu.index, entry);
    }
  }

  return Array.from(seriesByGpu.entries()).map(([index, entry]) => ({
    index,
    label: entry.label,
    series: [
      { name: 'GPU 利用率', data: entry.utilization, color: '#8b5cf6', unit: '%' },
      { name: '显存占用', data: entry.memoryUsage, color: '#ec4899', unit: '%' },
      { name: '显存带宽利用率', data: entry.memoryBandwidth, color: '#f97316', unit: '%' },
    ] satisfies TimeSeriesChartSeries[],
  }));
}

export function formatPercentAxis(value: number): string {
  return `${value.toFixed(0)}%`;
}
