import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore.js';
import { useTransport } from '../transport/TransportProvider.js';
import { MetricChart } from '../components/MetricChart.js';
import { GaugeChart } from '../components/GaugeChart.js';
import { ProcessTable } from '../components/ProcessTable.js';
import { DockerList } from '../components/DockerList.js';
import { GpuAllocationBars } from '../components/GpuAllocationBars.js';
import { ProgressBar } from '../components/ProgressBar.js';
import { buildAdaptiveRateChart, formatBytesPerSecond } from '../utils/rates';
import { formatMemoryPairGB, formatVramGB, formatVramPairGB } from '../utils/vram.js';
import {
  getConnectionStatusVisual,
  getInternetReachabilityState,
  getInternetStatusVisual,
} from '../utils/nodeStatus.js';
import type {
  MetricsSnapshot,
  MetricsHistoryResponse,
  MetricsBucketRow,
  ProcessAuditRow,
  ServerPersonActivity,
  ResolvedGpuAllocationResponse,
  ProcessHistoryFrame,
  ProcessReplayIndexPoint,
} from '@monitor/core';

type Tab = 'overview' | 'history' | 'processes' | 'docker' | 'tasks';

type HistoryRange = '1h' | '6h' | '24h' | '7d' | '30d' | '90d';
type ProcessReplayRange = '1h' | '6h' | '24h' | '72h';

const HISTORY_RANGES: { key: HistoryRange; label: string; ms: number }[] = [
  { key: '1h', label: '1 小时', ms: 3_600_000 },
  { key: '6h', label: '6 小时', ms: 6 * 3_600_000 },
  { key: '24h', label: '24 小时', ms: 24 * 3_600_000 },
  { key: '7d', label: '7 天', ms: 7 * 86_400_000 },
  { key: '30d', label: '30 天', ms: 30 * 86_400_000 },
  { key: '90d', label: '90 天', ms: 90 * 86_400_000 },
];

const PROCESS_REPLAY_RANGES: { key: ProcessReplayRange; label: string; ms: number }[] = [
  { key: '1h', label: '1 小时', ms: 3_600_000 },
  { key: '6h', label: '6 小时', ms: 6 * 3_600_000 },
  { key: '24h', label: '24 小时', ms: 24 * 3_600_000 },
  { key: '72h', label: '72 小时', ms: 72 * 3_600_000 },
];

function bucketGranularityLabel(bucketMs: number): string {
  if (bucketMs <= 60_000) return '1 分钟';
  if (bucketMs <= 900_000) return '15 分钟';
  return `${Math.round(bucketMs / 60_000)} 分钟`;
}

function getGpuUtilTextClass(utilizationPercent: number) {
  if (utilizationPercent >= 90) {
    return 'text-accent-red';
  }

  if (utilizationPercent >= 10) {
    return 'text-accent-yellow';
  }

  return 'text-accent-green';
}

function formatLastSeen(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatReplayTimestamp(timestamp: number | null): string {
  if (!timestamp) {
    return '--';
  }

  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function getSourceVisual(sourceType: string) {
  if (sourceType === 'agent') {
    return {
      label: 'Agent',
      badgeClassName: 'node-badge-source-agent',
    };
  }

  return {
    label: 'SSH',
    badgeClassName: 'node-badge-source-ssh',
  };
}

const backButtonClassName = 'inline-flex shrink-0 items-center gap-2 rounded-full border border-sky-300/25 bg-slate-950/70 px-4 py-2 text-sm font-semibold text-sky-100 shadow-[0_16px_40px_rgba(14,165,233,0.12)] transition-colors hover:border-sky-200/45 hover:bg-slate-900 hover:text-white';

export function ServerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const transport = useTransport();
  const { servers, latestMetrics, statuses, taskQueueGroups } = useStore();
  const [tab, setTab] = useState<Tab>('overview');
  const [history, setHistory] = useState<MetricsSnapshot[]>([]);
  const [processAudit, setProcessAudit] = useState<ProcessAuditRow[]>([]);
  const [processMode, setProcessMode] = useState<'live' | 'replay'>('live');
  const [processReplayRange, setProcessReplayRange] = useState<ProcessReplayRange>('6h');
  const [processReplayIndex, setProcessReplayIndex] = useState<ProcessReplayIndexPoint[]>([]);
  const [processReplayFrame, setProcessReplayFrame] = useState<ProcessHistoryFrame | null>(null);
  const [processReplayLoading, setProcessReplayLoading] = useState(false);
  const [processReplayFrameLoading, setProcessReplayFrameLoading] = useState(false);
  const [selectedReplayTimestamp, setSelectedReplayTimestamp] = useState<number | null>(null);
  const [processReplayNotice, setProcessReplayNotice] = useState<string | null>(null);
  const [processReplayFrameError, setProcessReplayFrameError] = useState<string | null>(null);
  const [processReplayPlaying, setProcessReplayPlaying] = useState(false);
  const [personActivity, setPersonActivity] = useState<ServerPersonActivity | null>(null);
  const [resolvedGpuAllocation, setResolvedGpuAllocation] = useState<ResolvedGpuAllocationResponse | null>(null);
  const [historyRange, setHistoryRange] = useState<HistoryRange>('24h');
  const [bucketedData, setBucketedData] = useState<MetricsHistoryResponse | null>(null);
  const [bucketedLoading, setBucketedLoading] = useState(false);
  const bucketedRequestIdRef = useRef(0);
  const requestScopeRef = useRef({ serverId: id, version: 0 });
  const historyRequestIdRef = useRef(0);
  const processAuditRequestIdRef = useRef(0);
  const processReplayIndexRequestIdRef = useRef(0);
  const processReplayFrameRequestIdRef = useRef(0);

  if (requestScopeRef.current.serverId !== id) {
    requestScopeRef.current = {
      serverId: id,
      version: requestScopeRef.current.version + 1,
    };
  }

  const server = servers.find(s => s.id === id);
  const metrics = id ? latestMetrics.get(id) : undefined;
  const status = id ? statuses.get(id) : undefined;
  const taskQueueGroup = taskQueueGroups.find((group) => group.serverId === id);
  const supportsProcessReplay = typeof transport.getProcessHistoryIndex === 'function'
    && typeof transport.getProcessHistoryFrame === 'function';

  const loadHistory = useCallback(async () => {
    if (!id) return;
    const serverId = id;
    const scopeVersion = requestScopeRef.current.version;
    const requestId = ++historyRequestIdRef.current;
    const to = Date.now();
    const from = to - 30 * 60 * 1000; // Last 30 minutes
    try {
      const data = await transport.getMetricsHistory(serverId, from, to);
      if (
        requestScopeRef.current.serverId !== serverId ||
        requestScopeRef.current.version !== scopeVersion ||
        historyRequestIdRef.current !== requestId
      ) {
        return;
      }
      setHistory(data);
    } catch {
      if (
        requestScopeRef.current.serverId !== serverId ||
        requestScopeRef.current.version !== scopeVersion ||
        historyRequestIdRef.current !== requestId
      ) {
        return;
      }
      setHistory([]);
    }
  }, [id, transport]);

  const loadProcessAudit = useCallback(async () => {
    if (!id) return;
    const serverId = id;
    const scopeVersion = requestScopeRef.current.version;
    const requestId = ++processAuditRequestIdRef.current;
    try {
      const rows = await transport.getProcessAudit(serverId);
      if (
        requestScopeRef.current.serverId !== serverId ||
        requestScopeRef.current.version !== scopeVersion ||
        processAuditRequestIdRef.current !== requestId
      ) {
        return;
      }
      setProcessAudit(rows);
    } catch {
      if (
        requestScopeRef.current.serverId !== serverId ||
        requestScopeRef.current.version !== scopeVersion ||
        processAuditRequestIdRef.current !== requestId
      ) {
        return;
      }
      setProcessAudit([]);
    }
  }, [id, transport]);

  const loadProcessReplayIndex = useCallback(async () => {
    if (!id || !transport.getProcessHistoryIndex) return;
    const serverId = id;
    const scopeVersion = requestScopeRef.current.version;
    const requestId = ++processReplayIndexRequestIdRef.current;
    setProcessReplayLoading(true);
    setProcessReplayNotice(null);
    const rangeMs = PROCESS_REPLAY_RANGES.find((range) => range.key === processReplayRange)?.ms ?? 6 * 3_600_000;
    const to = Date.now();
    const from = to - rangeMs;

    try {
      const points = await transport.getProcessHistoryIndex(serverId, from, to);
      if (
        requestScopeRef.current.serverId !== serverId ||
        requestScopeRef.current.version !== scopeVersion ||
        processReplayIndexRequestIdRef.current !== requestId
      ) {
        return;
      }

      setProcessReplayIndex(points);
      setSelectedReplayTimestamp((current) => {
        if (current !== null && points.some((point) => point.timestamp === current)) {
          return current;
        }
        return points.length > 0 ? points[points.length - 1]!.timestamp : null;
      });
      if (points.length === 0) {
        setProcessReplayFrame(null);
      }
    } catch {
      if (
        requestScopeRef.current.serverId !== serverId ||
        requestScopeRef.current.version !== scopeVersion ||
        processReplayIndexRequestIdRef.current !== requestId
      ) {
        return;
      }

      setProcessReplayIndex([]);
      setSelectedReplayTimestamp(null);
      setProcessReplayFrame(null);
      setProcessReplayPlaying(false);
      setProcessReplayNotice('历史回放暂不可用，已切回实时视图。');
      setProcessMode('live');
    } finally {
      setProcessReplayLoading(false);
    }
  }, [id, processReplayRange, transport]);

  const loadProcessReplayFrame = useCallback(async (timestamp: number) => {
    if (!id || !transport.getProcessHistoryFrame) return;
    const serverId = id;
    const scopeVersion = requestScopeRef.current.version;
    const requestId = ++processReplayFrameRequestIdRef.current;
    setProcessReplayFrameLoading(true);
    setProcessReplayFrameError(null);

    try {
      const frame = await transport.getProcessHistoryFrame(serverId, timestamp);
      if (
        requestScopeRef.current.serverId !== serverId ||
        requestScopeRef.current.version !== scopeVersion ||
        processReplayFrameRequestIdRef.current !== requestId
      ) {
        return;
      }

      setProcessReplayFrame(frame);
    } catch {
      if (
        requestScopeRef.current.serverId !== serverId ||
        requestScopeRef.current.version !== scopeVersion ||
        processReplayFrameRequestIdRef.current !== requestId
      ) {
        return;
      }

      setProcessReplayFrame(null);
      setProcessReplayFrameError('选定时间点的历史帧不可用。');
    } finally {
      setProcessReplayFrameLoading(false);
    }
  }, [id, transport]);

  const loadBucketedHistory = useCallback(async () => {
    if (!id) return;
    const serverId = id;
    const scopeVersion = requestScopeRef.current.version;
    const requestId = ++bucketedRequestIdRef.current;
    setBucketedLoading(true);
    const rangeMs = HISTORY_RANGES.find(r => r.key === historyRange)?.ms ?? 24 * 3_600_000;
    const to = Date.now();
    const from = to - rangeMs;
    try {
      const data = await transport.getMetricsHistoryBucketed(serverId, from, to);
      if (
        requestScopeRef.current.serverId !== serverId ||
        requestScopeRef.current.version !== scopeVersion ||
        bucketedRequestIdRef.current !== requestId
      ) return;
      setBucketedData(data);
    } catch {
      if (
        requestScopeRef.current.serverId !== serverId ||
        requestScopeRef.current.version !== scopeVersion ||
        bucketedRequestIdRef.current !== requestId
      ) return;
      setBucketedData(null);
    } finally {
      setBucketedLoading(false);
    }
  }, [id, transport, historyRange]);

  useLayoutEffect(() => {
    setHistory([]);
    setProcessAudit([]);
    setProcessMode('live');
    setProcessReplayRange('6h');
    setProcessReplayIndex([]);
    setProcessReplayFrame(null);
    setSelectedReplayTimestamp(null);
    setProcessReplayNotice(null);
    setProcessReplayFrameError(null);
    setProcessReplayPlaying(false);
  }, [id]);

  useEffect(() => {
    void loadHistory();
    const interval = setInterval(loadHistory, 30_000);
    return () => clearInterval(interval);
  }, [loadHistory]);

  useEffect(() => {
    void loadProcessAudit();
  }, [loadProcessAudit]);

  useEffect(() => {
    if (tab === 'processes' && processMode === 'replay' && supportsProcessReplay) {
      void loadProcessReplayIndex();
    }
  }, [tab, processMode, supportsProcessReplay, loadProcessReplayIndex]);

  useEffect(() => {
    if (
      tab === 'processes'
      && processMode === 'replay'
      && supportsProcessReplay
      && selectedReplayTimestamp !== null
    ) {
      void loadProcessReplayFrame(selectedReplayTimestamp);
    }
  }, [tab, processMode, supportsProcessReplay, selectedReplayTimestamp, loadProcessReplayFrame]);

  useEffect(() => {
    if (!processReplayPlaying || processMode !== 'replay' || processReplayIndex.length <= 1) {
      return;
    }

    const timer = window.setInterval(() => {
      setSelectedReplayTimestamp((current) => {
        if (current === null) {
          return processReplayIndex[0]?.timestamp ?? null;
        }

        const currentIndex = processReplayIndex.findIndex((point) => point.timestamp === current);
        if (currentIndex < 0) {
          return processReplayIndex[0]?.timestamp ?? null;
        }

        if (currentIndex >= processReplayIndex.length - 1) {
          setProcessReplayPlaying(false);
          return current;
        }

        return processReplayIndex[currentIndex + 1]!.timestamp;
      });
    }, 1200);

    return () => window.clearInterval(timer);
  }, [processMode, processReplayIndex, processReplayPlaying]);

  useEffect(() => {
    if (tab === 'history') {
      void loadBucketedHistory();
    }
  }, [tab, loadBucketedHistory]);

  useEffect(() => {
    if (!id) return;
    void transport.getServerPersonActivity(id).then(setPersonActivity).catch(() => setPersonActivity(null));
    void transport.getResolvedGpuAllocation(id).then(setResolvedGpuAllocation).catch(() => setResolvedGpuAllocation(null));
  }, [id, transport]);

  // Append new metrics to history
  useEffect(() => {
    if (metrics) {
      setHistory(prev => {
        const cutoff = Date.now() - 30 * 60 * 1000;
        const filtered = prev.filter(m => m.timestamp > cutoff);
        if (filtered.length > 0 && filtered[filtered.length - 1].timestamp === metrics.timestamp) {
          return filtered;
        }
        return [...filtered, metrics];
      });
    }
  }, [metrics]);

  if (!server) {
    return (
      <div className="p-6">
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-3xl border border-dark-border bg-dark-card/80 px-6 py-10 text-center">
          <p className="text-slate-300">节点不存在</p>
          <button onClick={() => navigate('/')} className={backButtonClassName}>
            <span aria-hidden="true">←</span>
            <span>返回控制台</span>
          </button>
        </div>
      </div>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: '概览' },
    { key: 'history', label: '历史' },
    ...(server.sourceType === 'agent' ? [{ key: 'tasks' as const, label: '任务' }] : []),
    { key: 'processes', label: '进程' },
    { key: 'docker', label: 'Docker' },
  ];
  const statusVisual = getConnectionStatusVisual(status?.status ?? 'disconnected');
  const internetVisual = getInternetStatusVisual(getInternetReachabilityState(metrics));
  const sourceVisual = getSourceVisual(server.sourceType);

  const cpuData = history.map(h => ({ time: h.timestamp, value: h.cpu.usagePercent }));
  const memData = history.map(h => ({ time: h.timestamp, value: h.memory.usagePercent }));
  const netRxData = history.map(h => ({ time: h.timestamp, value: h.network.rxBytesPerSec / 1024 }));
  const netTxData = history.map(h => ({ time: h.timestamp, value: h.network.txBytesPerSec / 1024 }));
  const diskReadData = history.map(h => ({ time: h.timestamp, value: h.disk.ioReadKBs }));
  const diskWriteData = history.map(h => ({ time: h.timestamp, value: h.disk.ioWriteKBs }));
  const networkRateChart = buildAdaptiveRateChart([
    { name: '接收', data: netRxData, color: '#10b981' },
    { name: '发送', data: netTxData, color: '#3b82f6' },
  ]);
  const diskRateChart = buildAdaptiveRateChart([
    { name: '读取', data: diskReadData, color: '#06b6d4' },
    { name: '写入', data: diskWriteData, color: '#f59e0b' },
  ]);
  const replayFrameIndex = selectedReplayTimestamp === null
    ? -1
    : processReplayIndex.findIndex((point) => point.timestamp === selectedReplayTimestamp);
  const selectedReplayPoint = replayFrameIndex >= 0 ? processReplayIndex[replayFrameIndex] : null;
  const processRows = processMode === 'replay'
    ? (processReplayFrame?.processes ?? [])
    : processAudit;

  const stepReplayFrame = (direction: -1 | 1) => {
    if (processReplayIndex.length === 0) {
      return;
    }

    const currentIndex = replayFrameIndex >= 0 ? replayFrameIndex : processReplayIndex.length - 1;
    const nextIndex = Math.min(Math.max(currentIndex + direction, 0), processReplayIndex.length - 1);
    setSelectedReplayTimestamp(processReplayIndex[nextIndex]!.timestamp);
  };

  return (
    <div className="p-6">
      <div className={`node-surface-shell ${statusVisual.surfaceClassName} mb-6 rounded-3xl p-5`}>
        <div className="flex items-start gap-4">
          <button onClick={() => navigate('/')} className={backButtonClassName}>
            <span aria-hidden="true">←</span>
            <span>返回控制台</span>
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-bold text-slate-100">{server.name}</h1>
              <span className={`node-badge-base ${sourceVisual.badgeClassName}`}>{sourceVisual.label}</span>
              <span className={`node-badge-base ${statusVisual.badgeClassName}`}>
                <span className={`h-2 w-2 rounded-full ${statusVisual.dotClassName}`} />
                {statusVisual.label}
              </span>
              <span className={`node-badge-base ${internetVisual.badgeClassName}`}>
                <span className={`h-2 w-2 rounded-full ${internetVisual.dotClassName}`} />
                {internetVisual.label}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-400">
              <span>{server.host}:{server.port}</span>
              {metrics?.system.hostname && <span>{metrics.system.hostname}</span>}
              {metrics?.system.uptime && <span>运行 {metrics.system.uptime}</span>}
              {status?.agentVersion && <span>v{status.agentVersion}</span>}
              {status?.status && status.status !== 'connected' && status.lastSeen > 0 && (
                <span className="text-slate-500">最后上报 {formatLastSeen(status.lastSeen)}</span>
              )}
            </div>
            {status?.status === 'error' && status.error && (
              <p className="mt-3 text-sm text-rose-200">{status.error}</p>
            )}
          </div>
        </div>
      </div>

      <div className="mb-6 flex gap-1 border-b border-dark-border">
        {tabs.map((currentTab) => (
          <button
            key={currentTab.key}
            onClick={() => setTab(currentTab.key)}
            className={`px-4 py-2 text-sm transition-colors ${
              tab === currentTab.key
                ? 'border-b-2 border-accent-blue text-accent-blue'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {currentTab.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className={`space-y-6${status?.status !== 'connected' && metrics ? ' opacity-50 grayscale' : ''}`}>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="flex flex-col items-center rounded-lg border border-dark-border bg-dark-card p-4">
              <GaugeChart value={metrics?.cpu.usagePercent ?? 0} label="CPU" size={100} />
              <p className="mt-1 text-xs text-slate-500">{metrics?.cpu.coreCount ?? 0} 核 · {metrics?.cpu.modelName?.split(' ').slice(-2).join(' ') ?? ''}</p>
            </div>
            <div className="flex flex-col items-center rounded-lg border border-dark-border bg-dark-card p-4">
              <GaugeChart value={metrics?.memory.usagePercent ?? 0} label="内存" size={100} />
              <p className="mt-1 text-xs text-slate-500">{formatMemoryPairGB(metrics?.memory.usedMB ?? 0, metrics?.memory.totalMB ?? 0)}</p>
            </div>
            <div className="rounded-lg border border-dark-border bg-dark-card p-4 text-center">
              <p className="mb-2 text-xs text-slate-500">网络</p>
              <p className="font-mono text-sm text-accent-green">↓ {formatBytesPerSecond(metrics?.network.rxBytesPerSec ?? 0)}</p>
              <p className="font-mono text-sm text-accent-blue">↑ {formatBytesPerSecond(metrics?.network.txBytesPerSec ?? 0)}</p>
            </div>
            <div className="rounded-lg border border-dark-border bg-dark-card p-4 text-center">
              {metrics?.gpu.available ? (
                <>
                  <p className="mb-2 text-xs text-slate-500">GPU × {metrics.gpu.gpuCount}</p>
                  <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 text-left">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">GPU 利用率</p>
                      <p className={`font-mono text-lg font-bold ${getGpuUtilTextClass(metrics.gpu.utilizationPercent)}`}>
                        {metrics.gpu.utilizationPercent.toFixed(0)}%
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500/80">VRAM</p>
                      <p className="font-mono text-sm font-semibold tracking-tight text-slate-300">
                        {formatVramPairGB(metrics.gpu.usedMemoryMB, metrics.gpu.totalMemoryMB)}
                      </p>
                      <p className="text-[11px] text-slate-500">{metrics.gpu.temperatureC}°C</p>
                    </div>
                  </div>
                  <div className="mt-3 text-left">
                    <ProgressBar label="VRAM" value={metrics.gpu.memoryUsagePercent} />
                  </div>
                </>
              ) : (
                <>
                  <p className="mb-2 text-xs text-slate-500">GPU</p>
                  <p className="text-sm text-slate-600">N/A</p>
                </>
              )}
            </div>
          </div>

          <GpuAllocationBars allocation={metrics?.gpuAllocation} resolved={resolvedGpuAllocation} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-dark-border bg-dark-card p-4">
              <h3 className="mb-2 text-sm text-slate-400">CPU / 内存</h3>
              <MetricChart
                series={[
                  { name: 'CPU', data: cpuData, color: '#3b82f6', unit: '%' },
                  { name: '内存', data: memData, color: '#10b981', unit: '%' },
                ]}
                yAxisFormatter={(value) => `${value}%`}
              />
            </div>
            <div className="rounded-lg border border-dark-border bg-dark-card p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm text-slate-400">网络吞吐</h3>
                <span className="text-xs text-slate-500">
                  {networkRateChart.usesDualAxes ? `双轴 ${networkRateChart.unitLabel}` : `单位 ${networkRateChart.unitLabel}`}
                </span>
              </div>
              <MetricChart
                series={networkRateChart.series}
                yAxes={networkRateChart.yAxes}
              />
            </div>
            <div className="rounded-lg border border-dark-border bg-dark-card p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm text-slate-400">磁盘 IO</h3>
                <span className="text-xs text-slate-500">
                  {diskRateChart.usesDualAxes ? `双轴 ${diskRateChart.unitLabel}` : `单位 ${diskRateChart.unitLabel}`}
                </span>
              </div>
              <MetricChart
                series={diskRateChart.series}
                yAxes={diskRateChart.yAxes}
              />
            </div>
            <div className="rounded-lg border border-dark-border bg-dark-card p-4">
              <h3 className="mb-2 text-sm text-slate-400">磁盘使用</h3>
              <div className="mt-2 space-y-2">
                {metrics?.disk.disks.map((disk, index) => (
                  <div key={index}>
                    <div className="mb-1 flex justify-between text-xs text-slate-400">
                      <span>{disk.mountPoint}</span>
                      <span>{disk.usedGB}G / {disk.totalGB}G ({disk.usagePercent}%)</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-dark-border">
                      <div
                        className={`h-full rounded-full ${
                          disk.usagePercent > 90 ? 'bg-accent-red' : disk.usagePercent > 70 ? 'bg-accent-yellow' : 'bg-accent-blue'
                        }`}
                        style={{ width: `${disk.usagePercent}%` }}
                      />
                    </div>
                  </div>
                ))}
                {(!metrics?.disk.disks || metrics.disk.disks.length === 0) && (
                  <p className="py-4 text-center text-sm text-slate-600">暂无数据</p>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-dark-border bg-dark-card p-4">
            <h3 className="mb-2 text-sm text-slate-400">系统信息</h3>
            <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
              <div><span className="text-slate-500">主机名</span><p className="mt-0.5 text-slate-300">{metrics?.system.hostname}</p></div>
              <div><span className="text-slate-500">内核</span><p className="mt-0.5 text-slate-300">{metrics?.system.kernelVersion}</p></div>
              <div><span className="text-slate-500">运行时间</span><p className="mt-0.5 text-slate-300">{metrics?.system.uptime}</p></div>
              <div><span className="text-slate-500">负载</span><p className="mt-0.5 text-slate-300">{metrics?.system.loadAvg1} / {metrics?.system.loadAvg5} / {metrics?.system.loadAvg15}</p></div>
              {status?.agentVersion && <div><span className="text-slate-500">Agent 版本</span><p className="mt-0.5 text-slate-300">v{status.agentVersion}</p></div>}
            </div>
          </div>

          {personActivity && personActivity.people.length > 0 && (
            <div className="rounded-lg border border-dark-border bg-dark-card p-4">
              <h3 className="mb-2 text-sm text-slate-400">人员活动</h3>
              <div className="space-y-2">
                {personActivity.people.map((person) => (
                  <div key={person.personId} className="flex justify-between text-sm text-slate-300">
                    <span>{person.displayName}</span>
                    <span className="text-slate-400">{formatVramGB(person.currentVramMB)}</span>
                  </div>
                ))}
              </div>
              {personActivity.unassignedVramMB > 0 && (
                <p className="mt-2 text-xs text-slate-500">未分配显存: {formatVramGB(personActivity.unassignedVramMB)}</p>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {HISTORY_RANGES.map((range) => (
              <button
                key={range.key}
                onClick={() => setHistoryRange(range.key)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  historyRange === range.key
                    ? 'bg-accent-blue text-white'
                    : 'border border-dark-border bg-dark-card text-slate-400 hover:text-slate-200'
                }`}
              >
                {range.label}
              </button>
            ))}
            {bucketedData && (
              <span className="ml-2 text-xs text-slate-500">
                粒度: {bucketGranularityLabel(bucketedData.bucketMs)} · 来源: {bucketedData.source === 'raw' ? '原始数据' : '聚合数据'}
              </span>
            )}
            {bucketedLoading && <span className="ml-2 text-xs text-slate-500">加载中…</span>}
          </div>

          {bucketedData && bucketedData.buckets.length > 0 && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-dark-border bg-dark-card p-4">
                <h3 className="mb-2 text-sm text-slate-400">CPU 使用率</h3>
                <MetricChart
                  series={[
                    { name: '平均', data: bucketedData.buckets.map(b => ({ time: b.bucketStart, value: b.cpuAvg })), color: '#3b82f6', unit: '%' },
                    { name: '峰值', data: bucketedData.buckets.map(b => ({ time: b.bucketStart, value: b.cpuMax })), color: '#ef4444', unit: '%' },
                  ]}
                  yAxisFormatter={(v) => `${v}%`}
                />
              </div>
              <div className="rounded-lg border border-dark-border bg-dark-card p-4">
                <h3 className="mb-2 text-sm text-slate-400">内存使用率</h3>
                <MetricChart
                  series={[
                    { name: '平均', data: bucketedData.buckets.map(b => ({ time: b.bucketStart, value: b.memPercAvg })), color: '#10b981', unit: '%' },
                    { name: '峰值 MB', data: bucketedData.buckets.map(b => ({ time: b.bucketStart, value: b.memTotalMB > 0 ? (b.memUsedMaxMB / b.memTotalMB) * 100 : 0 })), color: '#ef4444', unit: '%' },
                  ]}
                  yAxisFormatter={(v) => `${v}%`}
                />
              </div>
              <div className="rounded-lg border border-dark-border bg-dark-card p-4">
                <h3 className="mb-2 text-sm text-slate-400">GPU 利用率</h3>
                <MetricChart
                  series={[
                    { name: '平均', data: bucketedData.buckets.map(b => ({ time: b.bucketStart, value: b.gpuUtilAvg })), color: '#8b5cf6', unit: '%' },
                    { name: '峰值', data: bucketedData.buckets.map(b => ({ time: b.bucketStart, value: b.gpuUtilMax })), color: '#ef4444', unit: '%' },
                  ]}
                  yAxisFormatter={(v) => `${v}%`}
                />
              </div>
              <div className="rounded-lg border border-dark-border bg-dark-card p-4">
                <h3 className="mb-2 text-sm text-slate-400">GPU 显存</h3>
                <MetricChart
                  series={[
                    { name: '平均 MB', data: bucketedData.buckets.map(b => ({ time: b.bucketStart, value: b.gpuMemUsedAvgMB })), color: '#f59e0b', unit: 'MB' },
                    { name: '峰值 MB', data: bucketedData.buckets.map(b => ({ time: b.bucketStart, value: b.gpuMemUsedMaxMB })), color: '#ef4444', unit: 'MB' },
                  ]}
                  yAxisFormatter={(v) => `${v} MB`}
                />
              </div>
              <div className="rounded-lg border border-dark-border bg-dark-card p-4">
                <h3 className="mb-2 text-sm text-slate-400">网络吞吐</h3>
                <MetricChart
                  series={[
                    { name: '接收 KB/s', data: bucketedData.buckets.map(b => ({ time: b.bucketStart, value: b.netRxAvgBps / 1024 })), color: '#10b981', unit: 'KB/s' },
                    { name: '发送 KB/s', data: bucketedData.buckets.map(b => ({ time: b.bucketStart, value: b.netTxAvgBps / 1024 })), color: '#3b82f6', unit: 'KB/s' },
                  ]}
                />
              </div>
              <div className="rounded-lg border border-dark-border bg-dark-card p-4">
                <h3 className="mb-2 text-sm text-slate-400">磁盘 IO</h3>
                <MetricChart
                  series={[
                    { name: '读取 KB/s', data: bucketedData.buckets.map(b => ({ time: b.bucketStart, value: b.diskReadAvgKBs })), color: '#06b6d4', unit: 'KB/s' },
                    { name: '写入 KB/s', data: bucketedData.buckets.map(b => ({ time: b.bucketStart, value: b.diskWriteAvgKBs })), color: '#f59e0b', unit: 'KB/s' },
                  ]}
                />
              </div>
              <div className="rounded-lg border border-dark-border bg-dark-card p-4">
                <h3 className="mb-2 text-sm text-slate-400">外网连通率</h3>
                <MetricChart
                  series={[
                    { name: '连通率', data: bucketedData.buckets.map(b => ({ time: b.bucketStart, value: b.internetReachableRatio * 100 })), color: '#22d3ee', unit: '%' },
                  ]}
                  yAxisFormatter={(v) => `${v}%`}
                />
              </div>
              <div className="rounded-lg border border-dark-border bg-dark-card p-4">
                <h3 className="mb-2 text-sm text-slate-400">外网延迟</h3>
                <MetricChart
                  series={[
                    { name: '延迟', data: bucketedData.buckets.filter(b => b.internetLatencyAvgMs != null).map(b => ({ time: b.bucketStart, value: b.internetLatencyAvgMs! })), color: '#a78bfa', unit: 'ms' },
                  ]}
                  yAxisFormatter={(v) => `${v} ms`}
                />
              </div>
            </div>
          )}

          {bucketedData && bucketedData.buckets.length === 0 && !bucketedLoading && (
            <div className="rounded-lg border border-dark-border bg-dark-card p-8 text-center">
              <p className="text-sm text-slate-500">所选时间范围内无历史数据</p>
            </div>
          )}
        </div>
      )}

      {tab === 'tasks' && server.sourceType === 'agent' && (
        <div className="space-y-4 rounded-lg border border-dark-border bg-dark-card p-4">
          <div>
            <h3 className="mb-1 text-sm text-slate-300">当前任务组</h3>
            <p className="text-sm text-slate-400">
              排队 {taskQueueGroup?.queued.length ?? 0} / 运行中 {taskQueueGroup?.running.length ?? 0}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
            <div className="rounded-lg border border-dark-border/70 bg-dark-bg/40 p-3">
              <p className="mb-2 text-slate-500">排队任务</p>
              <div className="space-y-2">
                {(taskQueueGroup?.queued ?? []).map((task) => (
                  <div key={task.taskId} className="truncate font-mono text-slate-300">{task.taskId}</div>
                ))}
                {(taskQueueGroup?.queued.length ?? 0) === 0 && <p className="text-slate-600">暂无排队任务</p>}
              </div>
            </div>
            <div className="rounded-lg border border-dark-border/70 bg-dark-bg/40 p-3">
              <p className="mb-2 text-slate-500">运行中任务</p>
              <div className="space-y-2">
                {(taskQueueGroup?.running ?? []).map((task) => (
                  <div key={task.taskId} className="truncate font-mono text-slate-300">{task.taskId}</div>
                ))}
                {(taskQueueGroup?.running.length ?? 0) === 0 && <p className="text-slate-600">暂无运行任务</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'processes' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-dark-border bg-dark-card p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-sm font-medium text-slate-200">进程视图</h3>
                <p className="mt-1 text-xs text-slate-500">
                  {processMode === 'live'
                    ? '实时查看当前进程占用和风险归因。'
                    : '按时间轴回放历史进程快照，表格排序与筛选保持一致。'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setProcessMode('live');
                    setProcessReplayPlaying(false);
                    setProcessReplayFrameError(null);
                  }}
                  className={`rounded-full px-3 py-1.5 text-xs transition-colors ${processMode === 'live' ? 'bg-accent-blue text-white' : 'border border-dark-border bg-dark-bg/30 text-slate-300 hover:text-slate-100'}`}
                >
                  实时
                </button>
                <button
                  type="button"
                  disabled={!supportsProcessReplay}
                  onClick={() => {
                    if (!supportsProcessReplay) {
                      return;
                    }
                    setProcessMode('replay');
                    setProcessReplayNotice(null);
                  }}
                  className={`rounded-full px-3 py-1.5 text-xs transition-colors ${processMode === 'replay' ? 'bg-emerald-500 text-white' : 'border border-dark-border bg-dark-bg/30 text-slate-300 hover:text-slate-100'} ${!supportsProcessReplay ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  历史回放
                </button>
              </div>
            </div>

            {processReplayNotice && (
              <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-500/[0.08] px-3 py-2 text-xs text-amber-100">
                {processReplayNotice}
              </div>
            )}

            {processMode === 'replay' && supportsProcessReplay && (
              <div className="mt-4 space-y-4 rounded-2xl border border-dark-border/80 bg-dark-bg/30 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  {PROCESS_REPLAY_RANGES.map((range) => (
                    <button
                      key={range.key}
                      type="button"
                      onClick={() => setProcessReplayRange(range.key)}
                      className={`rounded-full px-3 py-1 text-xs transition-colors ${processReplayRange === range.key ? 'bg-accent-blue text-white' : 'border border-dark-border bg-dark-card text-slate-400 hover:text-slate-200'}`}
                    >
                      {range.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setProcessReplayPlaying((current) => !current)}
                    disabled={processReplayIndex.length <= 1}
                    className={`rounded-full px-3 py-1 text-xs transition-colors ${processReplayPlaying ? 'bg-accent-red text-white' : 'border border-dark-border bg-dark-card text-slate-300 hover:text-slate-100'} ${processReplayIndex.length <= 1 ? 'cursor-not-allowed opacity-50' : ''}`}
                  >
                    {processReplayPlaying ? '暂停' : '播放'}
                  </button>
                  <button
                    type="button"
                    onClick={() => stepReplayFrame(-1)}
                    disabled={processReplayIndex.length === 0 || replayFrameIndex <= 0}
                    className={`rounded-full border border-dark-border bg-dark-card px-3 py-1 text-xs text-slate-300 transition-colors hover:text-slate-100 ${processReplayIndex.length === 0 || replayFrameIndex <= 0 ? 'cursor-not-allowed opacity-50' : ''}`}
                  >
                    上一帧
                  </button>
                  <button
                    type="button"
                    onClick={() => stepReplayFrame(1)}
                    disabled={processReplayIndex.length === 0 || replayFrameIndex >= processReplayIndex.length - 1}
                    className={`rounded-full border border-dark-border bg-dark-card px-3 py-1 text-xs text-slate-300 transition-colors hover:text-slate-100 ${processReplayIndex.length === 0 || replayFrameIndex >= processReplayIndex.length - 1 ? 'cursor-not-allowed opacity-50' : ''}`}
                  >
                    下一帧
                  </button>
                  {processReplayLoading && <span className="text-xs text-slate-500">加载回放索引…</span>}
                  {processReplayFrameLoading && <span className="text-xs text-slate-500">加载历史帧…</span>}
                </div>

                {processReplayIndex.length > 0 ? (
                  <>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(processReplayIndex.length - 1, 0)}
                      step={1}
                      value={Math.max(replayFrameIndex, 0)}
                      onChange={(event) => {
                        const nextIndex = Number(event.target.value);
                        setSelectedReplayTimestamp(processReplayIndex[nextIndex]?.timestamp ?? null);
                        setProcessReplayPlaying(false);
                      }}
                      className="w-full accent-sky-400"
                    />

                    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                      <span>{formatReplayTimestamp(processReplayIndex[0]?.timestamp ?? null)}</span>
                      <span className="text-slate-200">当前 {formatReplayTimestamp(selectedReplayTimestamp)}</span>
                      <span>{formatReplayTimestamp(processReplayIndex[processReplayIndex.length - 1]?.timestamp ?? null)}</span>
                    </div>

                    {selectedReplayPoint && (
                      <div className="rounded-2xl border border-dark-border/80 bg-dark-card/70 px-3 py-2 text-xs text-slate-300">
                        当前帧 {selectedReplayPoint.processCount} 个进程 · GPU 进程 {selectedReplayPoint.gpuProcessCount} 个 · 风险进程 {selectedReplayPoint.suspiciousProcessCount} 个
                      </div>
                    )}
                  </>
                ) : !processReplayLoading && (
                  <div className="rounded-2xl border border-dashed border-dark-border px-4 py-6 text-center text-sm text-slate-500">
                    所选时间范围内暂无可回放进程帧
                  </div>
                )}

                {processReplayFrameError && (
                  <div className="rounded-2xl border border-rose-400/20 bg-rose-500/[0.08] px-3 py-2 text-xs text-rose-100">
                    {processReplayFrameError}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-dark-border bg-dark-card p-4">
            <ProcessTable processes={processRows} />
          </div>
        </div>
      )}

      {tab === 'docker' && (
        <div className="rounded-lg border border-dark-border bg-dark-card p-4">
          <DockerList containers={metrics?.docker ?? []} />
        </div>
      )}
    </div>
  );
}
