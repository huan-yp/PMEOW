import { useState, useEffect } from 'react';
import { useTransport } from '../../../transport/TransportProvider.js';
import type { UnifiedReport } from '../../../transport/types.js';
import type { ChartPoint, PerGpuRealtimeHistory } from '../utils/types.js';
import { REALTIME_WINDOW_SECONDS } from '../utils/types.js';
import { appendChartPoint } from '../utils/chart.js';
import { computeGpuTotals, computeGpuMemoryUsagePercent } from '../utils/gpu.js';

export function useRealtimeMetrics(id: string | undefined, report: UnifiedReport | undefined) {
  const transport = useTransport();

  const [cpuHistory, setCpuHistory] = useState<ChartPoint[]>([]);
  const [memHistory, setMemHistory] = useState<ChartPoint[]>([]);
  const [networkRxHistory, setNetworkRxHistory] = useState<ChartPoint[]>([]);
  const [networkTxHistory, setNetworkTxHistory] = useState<ChartPoint[]>([]);
  const [diskReadHistory, setDiskReadHistory] = useState<ChartPoint[]>([]);
  const [diskWriteHistory, setDiskWriteHistory] = useState<ChartPoint[]>([]);
  const [gpuTotalUtilHistory, setGpuTotalUtilHistory] = useState<ChartPoint[]>([]);
  const [gpuTotalVramHistory, setGpuTotalVramHistory] = useState<ChartPoint[]>([]);
  const [gpuRealtimeHistory, setGpuRealtimeHistory] = useState<Record<number, PerGpuRealtimeHistory>>({});

  // Reset and hydrate from recent history when node changes
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

    if (!id) return;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const fromSeconds = nowSeconds - REALTIME_WINDOW_SECONDS;
    transport.getMetricsHistory(id, { from: fromSeconds, to: nowSeconds, tier: 'recent' })
      .then((res) => {
        if (res.snapshots.length === 0) return;
        const cutoff = (nowSeconds - REALTIME_WINDOW_SECONDS) * 1000;
        const cpuPts: ChartPoint[] = [];
        const memPts: ChartPoint[] = [];
        const rxPts: ChartPoint[] = [];
        const txPts: ChartPoint[] = [];
        const diskRPts: ChartPoint[] = [];
        const diskWPts: ChartPoint[] = [];
        const gpuUtilPts: ChartPoint[] = [];
        const gpuVramPts: ChartPoint[] = [];
        const perGpu: Record<number, PerGpuRealtimeHistory> = {};

        for (const snap of res.snapshots) {
          const t = snap.timestamp * 1000;
          if (t <= cutoff) continue;
          cpuPts.push({ time: t, value: snap.cpu.usagePercent });
          memPts.push({ time: t, value: snap.memory.usagePercent });
          rxPts.push({ time: t, value: snap.network.rxBytesPerSec });
          txPts.push({ time: t, value: snap.network.txBytesPerSec });
          diskRPts.push({ time: t, value: snap.diskIo.readBytesPerSec });
          diskWPts.push({ time: t, value: snap.diskIo.writeBytesPerSec });
          const totals = computeGpuTotals(snap.gpuCards);
          gpuUtilPts.push({ time: t, value: totals.averageUtilization });
          gpuVramPts.push({ time: t, value: totals.totalVramPercent });
          for (const gpu of snap.gpuCards) {
            const cur = perGpu[gpu.index] ?? { utilization: [], memoryUsage: [], memoryBandwidth: [] };
            cur.utilization.push({ time: t, value: gpu.utilizationGpu });
            cur.memoryUsage.push({ time: t, value: computeGpuMemoryUsagePercent(gpu) });
            cur.memoryBandwidth.push({ time: t, value: gpu.utilizationMemory });
            perGpu[gpu.index] = cur;
          }
        }

        const merge = (prev: ChartPoint[], seed: ChartPoint[]) => {
          if (seed.length === 0) return prev;
          const merged = new Map<number, number>();
          for (const p of seed) merged.set(p.time, p.value);
          for (const p of prev) merged.set(p.time, p.value); // live points win
          const now = Date.now();
          const liveCutoff = now - REALTIME_WINDOW_SECONDS * 1000;
          return Array.from(merged.entries())
            .filter(([t]) => t > liveCutoff)
            .sort(([a], [b]) => a - b)
            .map(([time, value]) => ({ time, value }));
        };

        setCpuHistory((prev) => merge(prev, cpuPts));
        setMemHistory((prev) => merge(prev, memPts));
        setNetworkRxHistory((prev) => merge(prev, rxPts));
        setNetworkTxHistory((prev) => merge(prev, txPts));
        setDiskReadHistory((prev) => merge(prev, diskRPts));
        setDiskWriteHistory((prev) => merge(prev, diskWPts));
        setGpuTotalUtilHistory((prev) => merge(prev, gpuUtilPts));
        setGpuTotalVramHistory((prev) => merge(prev, gpuVramPts));
        setGpuRealtimeHistory((prev) => {
          const next: Record<number, PerGpuRealtimeHistory> = { ...prev };
          for (const [idx, seed] of Object.entries(perGpu)) {
            const i = Number(idx);
            const cur = next[i] ?? { utilization: [], memoryUsage: [], memoryBandwidth: [] };
            next[i] = {
              utilization: merge(cur.utilization, seed.utilization),
              memoryUsage: merge(cur.memoryUsage, seed.memoryUsage),
              memoryBandwidth: merge(cur.memoryBandwidth, seed.memoryBandwidth),
            };
          }
          return next;
        });
      })
      .catch(() => { /* ignore — live updates will still work */ });
  }, [id, transport]);

  // Append live data points from the latest report
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
        const current = prev[gpu.index] ?? { utilization: [], memoryUsage: [], memoryBandwidth: [] };
        next[gpu.index] = {
          utilization: appendChartPoint(current.utilization, now, gpu.utilizationGpu, cutoff),
          memoryUsage: appendChartPoint(current.memoryUsage, now, computeGpuMemoryUsagePercent(gpu), cutoff),
          memoryBandwidth: appendChartPoint(current.memoryBandwidth, now, gpu.utilizationMemory, cutoff),
        };
      }
      return next;
    });
  }, [report]);

  return {
    cpuHistory,
    memHistory,
    networkRxHistory,
    networkTxHistory,
    diskReadHistory,
    diskWriteHistory,
    gpuTotalUtilHistory,
    gpuTotalVramHistory,
    gpuRealtimeHistory,
  };
}
