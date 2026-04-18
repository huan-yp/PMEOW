import { useEffect, useState } from 'react';
import type { UnifiedReport } from '@monitor/app-common';
import { MobileApiClient } from '../lib/api';
import {
  appendChartPoint,
  buildGpuHistoryFromSnapshots,
  ChartPoint,
  computeGpuMemoryUsagePercent,
  mergeChartPoints,
  PerGpuRealtimeHistory,
  REALTIME_WINDOW_SECONDS,
} from './metrics';

export function useServerGpuHistory(
  serverId: string | null,
  report: UnifiedReport | undefined,
  baseUrl: string,
  authToken: string | null,
) {
  const [gpuRealtimeHistory, setGpuRealtimeHistory] = useState<Record<number, PerGpuRealtimeHistory>>({});
  const [gpuHistoryLoading, setGpuHistoryLoading] = useState(false);

  useEffect(() => {
    setGpuRealtimeHistory({});

    if (!serverId || !baseUrl || !authToken) {
      setGpuHistoryLoading(false);
      return;
    }

    const client = new MobileApiClient(baseUrl, authToken);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const fromSeconds = nowSeconds - REALTIME_WINDOW_SECONDS;
    const cutoff = fromSeconds * 1000;

    setGpuHistoryLoading(true);
    client.getMetricsHistory(serverId, { from: fromSeconds, to: nowSeconds, tier: 'recent' })
      .then((result) => {
        setGpuRealtimeHistory(buildGpuHistoryFromSnapshots(result.snapshots, cutoff));
      })
      .catch(() => {
        setGpuRealtimeHistory({});
      })
      .finally(() => {
        setGpuHistoryLoading(false);
      });
  }, [authToken, baseUrl, serverId]);

  useEffect(() => {
    if (!report) {
      return;
    }

    const time = report.timestamp * 1000;
    const cutoff = time - REALTIME_WINDOW_SECONDS * 1000;

    setGpuRealtimeHistory((prev) => {
      const next: Record<number, PerGpuRealtimeHistory> = {};

      for (const gpu of report.resourceSnapshot.gpuCards) {
        const current = prev[gpu.index] ?? { utilization: [], memoryUsage: [], memoryBandwidth: [] };
        next[gpu.index] = {
          utilization: appendChartPoint(current.utilization, time, gpu.utilizationGpu, cutoff),
          memoryUsage: appendChartPoint(current.memoryUsage, time, computeGpuMemoryUsagePercent(gpu), cutoff),
          memoryBandwidth: appendChartPoint(current.memoryBandwidth, time, gpu.utilizationMemory, cutoff),
        };
      }

      for (const [index, existing] of Object.entries(prev)) {
        const gpuIndex = Number(index);
        if (next[gpuIndex]) {
          next[gpuIndex] = {
            utilization: mergeChartPoints(next[gpuIndex].utilization, existing.utilization as ChartPoint[], cutoff),
            memoryUsage: mergeChartPoints(next[gpuIndex].memoryUsage, existing.memoryUsage as ChartPoint[], cutoff),
            memoryBandwidth: mergeChartPoints(next[gpuIndex].memoryBandwidth, existing.memoryBandwidth as ChartPoint[], cutoff),
          };
        }
      }

      return next;
    });
  }, [report]);

  return { gpuRealtimeHistory, gpuHistoryLoading };
}