import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore.js';
import { useTransport } from '../transport/TransportProvider.js';
import { MetricChart } from '../components/MetricChart.js';
import { GaugeChart } from '../components/GaugeChart.js';
import { ProcessTable } from '../components/ProcessTable.js';
import { DockerList } from '../components/DockerList.js';
import type { MetricsSnapshot } from '@monitor/core';

type Tab = 'overview' | 'processes' | 'docker';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B/s';
  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

export function ServerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const transport = useTransport();
  const { servers, latestMetrics, statuses } = useStore();
  const [tab, setTab] = useState<Tab>('overview');
  const [history, setHistory] = useState<MetricsSnapshot[]>([]);

  const server = servers.find(s => s.id === id);
  const metrics = id ? latestMetrics.get(id) : undefined;
  const status = id ? statuses.get(id) : undefined;

  const loadHistory = useCallback(async () => {
    if (!id) return;
    const to = Date.now();
    const from = to - 30 * 60 * 1000; // Last 30 minutes
    const data = await transport.getMetricsHistory(id, from, to);
    setHistory(data);
  }, [id, transport]);

  useEffect(() => {
    loadHistory();
    const interval = setInterval(loadHistory, 30_000);
    return () => clearInterval(interval);
  }, [loadHistory]);

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
      <div className="p-6 text-center text-slate-500">
        服务器不存在
        <button onClick={() => navigate('/')} className="ml-2 text-accent-blue underline">返回</button>
      </div>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: '概览' },
    { key: 'processes', label: '进程' },
    { key: 'docker', label: 'Docker' },
  ];

  const cpuData = history.map(h => ({ time: h.timestamp, value: h.cpu.usagePercent }));
  const memData = history.map(h => ({ time: h.timestamp, value: h.memory.usagePercent }));
  const netRxData = history.map(h => ({ time: h.timestamp, value: h.network.rxBytesPerSec / 1024 }));
  const netTxData = history.map(h => ({ time: h.timestamp, value: h.network.txBytesPerSec / 1024 }));
  const diskReadData = history.map(h => ({ time: h.timestamp, value: h.disk.ioReadKBs }));
  const diskWriteData = history.map(h => ({ time: h.timestamp, value: h.disk.ioWriteKBs }));

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/')} className="text-slate-500 hover:text-slate-300 text-lg">←</button>
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${
            status?.status === 'connected' ? 'bg-accent-green' :
            status?.status === 'error' ? 'bg-accent-red' : 'bg-slate-600'
          }`} />
          <h1 className="text-xl font-bold text-slate-100">{server.name}</h1>
          <span className="text-sm text-slate-500">{server.host}:{server.port}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-dark-border">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm transition-colors ${
              tab === t.key
                ? 'text-accent-blue border-b-2 border-accent-blue'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-6">
          {/* Gauges + System Info */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-dark-card border border-dark-border rounded-lg p-4 flex flex-col items-center">
              <GaugeChart value={metrics?.cpu.usagePercent ?? 0} label="CPU" size={100} />
              <p className="text-xs text-slate-500 mt-1">{metrics?.cpu.coreCount ?? 0} 核 · {metrics?.cpu.modelName?.split(' ').slice(-2).join(' ') ?? ''}</p>
            </div>
            <div className="bg-dark-card border border-dark-border rounded-lg p-4 flex flex-col items-center">
              <GaugeChart value={metrics?.memory.usagePercent ?? 0} label="内存" size={100} />
              <p className="text-xs text-slate-500 mt-1">{metrics?.memory.usedMB ?? 0} / {metrics?.memory.totalMB ?? 0} MB</p>
            </div>
            <div className="bg-dark-card border border-dark-border rounded-lg p-4 text-center">
              <p className="text-slate-500 text-xs mb-2">网络</p>
              <p className="text-accent-green font-mono text-sm">↓ {formatBytes(metrics?.network.rxBytesPerSec ?? 0)}</p>
              <p className="text-accent-blue font-mono text-sm">↑ {formatBytes(metrics?.network.txBytesPerSec ?? 0)}</p>
            </div>
            <div className="bg-dark-card border border-dark-border rounded-lg p-4 text-center">
              {metrics?.gpu.available ? (
                <>
                  <p className="text-slate-500 text-xs mb-2">GPU × {metrics.gpu.gpuCount}</p>
                  <p className={`font-mono text-lg font-bold ${metrics.gpu.memoryUsagePercent < 10 ? 'text-accent-green' : 'text-accent-yellow'}`}>
                    {metrics.gpu.memoryUsagePercent.toFixed(0)}%
                  </p>
                  <p className="text-xs text-slate-500">{metrics.gpu.usedMemoryMB}/{metrics.gpu.totalMemoryMB} MB · {metrics.gpu.temperatureC}°C</p>
                </>
              ) : (
                <>
                  <p className="text-slate-500 text-xs mb-2">GPU</p>
                  <p className="text-slate-600 text-sm">N/A</p>
                </>
              )}
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-dark-card border border-dark-border rounded-lg p-4">
              <h3 className="text-sm text-slate-400 mb-2">CPU / 内存</h3>
              <MetricChart
                series={[
                  { name: 'CPU', data: cpuData, color: '#3b82f6', unit: '%' },
                  { name: '内存', data: memData, color: '#10b981', unit: '%' },
                ]}
                yAxisFormatter={(v) => `${v}%`}
              />
            </div>
            <div className="bg-dark-card border border-dark-border rounded-lg p-4">
              <h3 className="text-sm text-slate-400 mb-2">网络吞吐</h3>
              <MetricChart
                series={[
                  { name: '接收', data: netRxData, color: '#10b981', unit: 'KB/s' },
                  { name: '发送', data: netTxData, color: '#3b82f6', unit: 'KB/s' },
                ]}
                yAxisFormatter={(v) => `${v}KB/s`}
              />
            </div>
            <div className="bg-dark-card border border-dark-border rounded-lg p-4">
              <h3 className="text-sm text-slate-400 mb-2">磁盘 IO</h3>
              <MetricChart
                series={[
                  { name: '读取', data: diskReadData, color: '#06b6d4', unit: 'KB/s' },
                  { name: '写入', data: diskWriteData, color: '#f59e0b', unit: 'KB/s' },
                ]}
                yAxisFormatter={(v) => `${v}KB/s`}
              />
            </div>
            <div className="bg-dark-card border border-dark-border rounded-lg p-4">
              <h3 className="text-sm text-slate-400 mb-2">磁盘使用</h3>
              <div className="space-y-2 mt-2">
                {metrics?.disk.disks.map((d, i) => (
                  <div key={i}>
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span>{d.mountPoint}</span>
                      <span>{d.usedGB}G / {d.totalGB}G ({d.usagePercent}%)</span>
                    </div>
                    <div className="h-1.5 bg-dark-border rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          d.usagePercent > 90 ? 'bg-accent-red' : d.usagePercent > 70 ? 'bg-accent-yellow' : 'bg-accent-blue'
                        }`}
                        style={{ width: `${d.usagePercent}%` }}
                      />
                    </div>
                  </div>
                ))}
                {(!metrics?.disk.disks || metrics.disk.disks.length === 0) && (
                  <p className="text-slate-600 text-sm text-center py-4">暂无数据</p>
                )}
              </div>
            </div>
          </div>

          {/* System info */}
          <div className="bg-dark-card border border-dark-border rounded-lg p-4">
            <h3 className="text-sm text-slate-400 mb-2">系统信息</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div><span className="text-slate-500">主机名</span><p className="text-slate-300 mt-0.5">{metrics?.system.hostname}</p></div>
              <div><span className="text-slate-500">内核</span><p className="text-slate-300 mt-0.5">{metrics?.system.kernelVersion}</p></div>
              <div><span className="text-slate-500">运行时间</span><p className="text-slate-300 mt-0.5">{metrics?.system.uptime}</p></div>
              <div><span className="text-slate-500">负载</span><p className="text-slate-300 mt-0.5">{metrics?.system.loadAvg1} / {metrics?.system.loadAvg5} / {metrics?.system.loadAvg15}</p></div>
            </div>
          </div>
        </div>
      )}

      {tab === 'processes' && (
        <div className="bg-dark-card border border-dark-border rounded-lg p-4">
          <ProcessTable processes={metrics?.processes ?? []} />
        </div>
      )}

      {tab === 'docker' && (
        <div className="bg-dark-card border border-dark-border rounded-lg p-4">
          <DockerList containers={metrics?.docker ?? []} />
        </div>
      )}
    </div>
  );
}
