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
import type { MetricsSnapshot, ProcessAuditRow, ServerPersonActivity, ResolvedGpuAllocationResponse } from '@monitor/core';

type Tab = 'overview' | 'processes' | 'docker' | 'tasks';

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

function getStatusVisual(status: string) {
  switch (status) {
    case 'connected':
      return {
        label: '在线',
        badgeClassName: 'node-badge-status-online',
        dotClassName: 'bg-sky-300',
        surfaceClassName: 'node-surface-shell-online',
      };
    case 'connecting':
      return {
        label: '连接中',
        badgeClassName: 'node-badge-status-connecting',
        dotClassName: 'bg-amber-300 animate-pulse-dot',
        surfaceClassName: 'node-surface-shell-connecting',
      };
    case 'error':
      return {
        label: '异常',
        badgeClassName: 'node-badge-status-error',
        dotClassName: 'bg-rose-300',
        surfaceClassName: 'node-surface-shell-error',
      };
    case 'disconnected':
    default:
      return {
        label: '离线',
        badgeClassName: 'node-badge-status-offline',
        dotClassName: 'bg-rose-300',
        surfaceClassName: 'node-surface-shell-offline',
      };
  }
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
  const [personActivity, setPersonActivity] = useState<ServerPersonActivity | null>(null);
  const [resolvedGpuAllocation, setResolvedGpuAllocation] = useState<ResolvedGpuAllocationResponse | null>(null);
  const requestScopeRef = useRef({ serverId: id, version: 0 });
  const historyRequestIdRef = useRef(0);
  const processAuditRequestIdRef = useRef(0);

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

  useLayoutEffect(() => {
    setHistory([]);
    setProcessAudit([]);
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
    ...(server.sourceType === 'agent' ? [{ key: 'tasks' as const, label: '任务' }] : []),
    { key: 'processes', label: '进程' },
    { key: 'docker', label: 'Docker' },
  ];
  const statusVisual = getStatusVisual(status?.status ?? 'disconnected');
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
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-400">
              <span>{server.host}:{server.port}</span>
              {metrics?.system.hostname && <span>{metrics.system.hostname}</span>}
              {metrics?.system.uptime && <span>运行 {metrics.system.uptime}</span>}
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
        <div className="rounded-lg border border-dark-border bg-dark-card p-4">
          <ProcessTable processes={processAudit} />
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
