import { useNavigate } from 'react-router-dom';
import type { ServerConfig, ServerStatus, MetricsSnapshot } from '@monitor/core';
import { GaugeChart } from './GaugeChart.js';
import { ProgressBar } from './ProgressBar.js';

interface Props {
  server: ServerConfig;
  status?: ServerStatus;
  metrics?: MetricsSnapshot;
}

const statusColor: Record<string, string> = {
  connected: 'bg-accent-green',
  connecting: 'bg-accent-yellow animate-pulse-dot',
  disconnected: 'bg-slate-600',
  error: 'bg-accent-red',
};

const statusLabel: Record<string, string> = {
  connected: '在线',
  connecting: '连接中',
  disconnected: '离线',
  error: '异常',
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

export function ServerCard({ server, status, metrics }: Props) {
  const navigate = useNavigate();
  const connStatus = status?.status ?? 'disconnected';

  return (
    <div
      onClick={() => navigate(`/server/${server.id}`)}
      className={`bg-dark-card border border-dark-border rounded-xl p-5 cursor-pointer transition-all duration-200 hover:border-accent-blue/40 hover:bg-dark-hover ${
        connStatus === 'connected' ? 'glow-blue' : connStatus === 'error' ? 'glow-red' : ''
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${statusColor[connStatus]}`} />
          <h3 className="text-base font-semibold text-slate-200 truncate">{server.name}</h3>
        </div>
        <span className="text-xs text-slate-500">{statusLabel[connStatus]}</span>
      </div>

      {/* Subtitle: hostname · uptime */}
      {metrics && (
        <p className="text-xs text-slate-600 truncate mb-3 pl-[18px]">
          {metrics.system.hostname} · {metrics.system.uptime}
        </p>
      )}
      {!metrics && <div className="mb-3" />}

      {connStatus === 'error' && status?.error && (
        <p className="text-xs text-accent-red/80 mb-3 truncate">{status.error}</p>
      )}

      {metrics ? (
        <>
          {/* Gauges row */}
          <div className="flex gap-4 mb-4">
            <div className="flex-1">
              <GaugeChart
                value={metrics.cpu.usagePercent}
                label="CPU"
                size={80}
              />
            </div>
            <div className="flex-1">
              <GaugeChart
                value={metrics.memory.usagePercent}
                label="内存"
                size={80}
              />
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-slate-500">磁盘</span>
              <p className="text-slate-300 font-mono mt-0.5">
                {metrics.disk.disks[0] ? `${metrics.disk.disks[0].usagePercent}%` : 'N/A'}
              </p>
            </div>
            <div>
              <span className="text-slate-500">网络</span>
              <p className="text-slate-300 font-mono mt-0.5">
                ↓{formatBytes(metrics.network.rxBytesPerSec)} ↑{formatBytes(metrics.network.txBytesPerSec)}
              </p>
            </div>
            <div>
              <span className="text-slate-500">负载</span>
              <p className="text-slate-300 font-mono mt-0.5">
                {metrics.system.loadAvg1.toFixed(2)} / {metrics.system.loadAvg5.toFixed(2)} / {metrics.system.loadAvg15.toFixed(2)}
              </p>
            </div>
            <div>
              <span className="text-slate-500">GPU</span>
              {metrics.gpu.available ? (
                <p className={`font-mono mt-0.5 ${
                  metrics.gpu.memoryUsagePercent < 10 ? 'text-accent-green' : 'text-accent-yellow'
                }`}>
                  {metrics.gpu.memoryUsagePercent < 10 ? '空闲' : '使用中'} {metrics.gpu.memoryUsagePercent.toFixed(0)}%
                </p>
              ) : (
                <p className="text-slate-600 mt-0.5">N/A</p>
              )}
            </div>
          </div>

          {/* Bottom progress bars */}
          <div className="mt-3 pt-3 border-t border-dark-border space-y-1.5">
            {metrics.gpu.available && (
              <ProgressBar label="GPU" value={metrics.gpu.utilizationPercent} />
            )}
            <ProgressBar
              label="磁盘(/)"
              value={(() => {
                const root = metrics.disk.disks.find(d => d.mountPoint === '/');
                return root ? root.usagePercent : (metrics.disk.disks[0]?.usagePercent ?? 0);
              })()}
            />
          </div>
        </>
      ) : (
        <div className="h-32 flex items-center justify-center text-slate-600 text-sm">
          {connStatus === 'connecting' ? '连接中...' : '暂无数据'}
        </div>
      )}
    </div>
  );
}
