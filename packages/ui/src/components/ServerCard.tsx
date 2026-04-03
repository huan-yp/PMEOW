import { useNavigate } from 'react-router-dom';
import type { ServerConfig, ServerStatus, MetricsSnapshot } from '@monitor/core';
import { GaugeChart } from './GaugeChart.js';
import { ProgressBar } from './ProgressBar.js';
import { useStore } from '../store/useStore.js';
import { formatBytesPerSecond } from '../utils/rates';

function getGpuUtilTextClass(utilizationPercent: number) {
  if (utilizationPercent >= 90) {
    return 'text-accent-red';
  }

  if (utilizationPercent >= 10) {
    return 'text-accent-yellow';
  }

  return 'text-accent-green';
}

interface Props {
  server: ServerConfig;
  status?: ServerStatus;
  metrics?: MetricsSnapshot;
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

function formatLastSeen(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function ServerCard({ server, status, metrics }: Props) {
  const navigate = useNavigate();
  const connStatus = status?.status ?? 'disconnected';
  const isStale = connStatus !== 'connected' && metrics !== undefined;
  const taskQueueGroup = useStore((state) => state.taskQueueGroups.find((group) => group.serverId === server.id));
  const hasOpenSecurityEvent = useStore((state) => state.openSecurityEvents.some((event) => event.serverId === server.id && !event.resolved));
  const statusVisual = getStatusVisual(connStatus);
  const sourceVisual = getSourceVisual(server.sourceType);

  return (
    <div
      onClick={() => navigate(`/server/${server.id}`)}
      className={`node-surface-shell node-card-shell ${statusVisual.surfaceClassName} rounded-2xl p-5 cursor-pointer`}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold text-slate-100">{server.name}</h3>
            {hasOpenSecurityEvent && <span className="node-badge-base node-badge-risk">风险</span>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`node-badge-base ${sourceVisual.badgeClassName}`}>{sourceVisual.label}</span>
            <span className={`node-badge-base ${statusVisual.badgeClassName}`}>
              <span className={`h-2 w-2 rounded-full ${statusVisual.dotClassName}`} />
              {statusVisual.label}
            </span>
          </div>
        </div>
      </div>

      {metrics && (
        <p className="mb-3 truncate text-xs text-slate-500">
          {metrics.system.hostname} · {server.host}:{server.port} · {metrics.system.uptime}
          {isStale && status?.lastSeen ? ` · 最后上报 ${formatLastSeen(status.lastSeen)}` : ''}
        </p>
      )}
      {!metrics && <p className="mb-3 truncate text-xs text-slate-500">{server.host}:{server.port}</p>}

      {connStatus === 'error' && status?.error && (
        <p className="mb-3 truncate text-xs text-accent-red/80">{status.error}</p>
      )}

      {server.sourceType === 'agent' && taskQueueGroup && (
        <div className="mb-3 rounded-xl border border-cyan-400/10 bg-cyan-500/[0.07] px-3 py-2 text-xs text-cyan-50/90">
          排队 {taskQueueGroup.queued.length} / 运行中 {taskQueueGroup.running.length}
        </div>
      )}

      {metrics ? (
        <div className={isStale ? 'opacity-50' : ''}>
          <div className="mb-4 flex gap-4">
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

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-slate-500">磁盘</span>
              <p className="mt-0.5 font-mono text-slate-300">
                {metrics.disk.disks[0] ? `${metrics.disk.disks[0].usagePercent}%` : 'N/A'}
              </p>
            </div>
            <div>
              <span className="text-slate-500">网络</span>
              <p className="mt-0.5 font-mono text-slate-300">
                ↓{formatBytesPerSecond(metrics.network.rxBytesPerSec)} ↑{formatBytesPerSecond(metrics.network.txBytesPerSec)}
              </p>
            </div>
            <div>
              <span className="text-slate-500">负载</span>
              <p className="mt-0.5 font-mono text-slate-300">
                {metrics.system.loadAvg1.toFixed(2)} / {metrics.system.loadAvg5.toFixed(2)} / {metrics.system.loadAvg15.toFixed(2)}
              </p>
            </div>
            <div>
              <span className="text-slate-500">GPU 利用率</span>
              {metrics.gpu.available ? (
                <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className={`font-mono ${getGpuUtilTextClass(metrics.gpu.utilizationPercent)}`}>
                    {metrics.gpu.utilizationPercent.toFixed(0)}%
                  </p>
                  <p className="font-mono text-[11px] font-medium tracking-tight text-slate-400">
                    VRAM {metrics.gpu.usedMemoryMB}/{metrics.gpu.totalMemoryMB} MB
                  </p>
                </div>
              ) : (
                <p className="mt-0.5 text-slate-600">N/A</p>
              )}
            </div>
          </div>

          <div className="mt-3 space-y-1.5 border-t border-dark-border pt-3">
            {metrics.gpu.available && (
              <ProgressBar label="VRAM" value={metrics.gpu.memoryUsagePercent} />
            )}
            <ProgressBar
              label="磁盘(/)"
              value={(() => {
                const root = metrics.disk.disks.find((disk) => disk.mountPoint === '/');
                return root ? root.usagePercent : (metrics.disk.disks[0]?.usagePercent ?? 0);
              })()}
            />
          </div>
        </div>
      ) : (
        <div className="flex h-32 items-center justify-center text-sm text-slate-600">
          {connStatus === 'connecting' ? '连接中...' : '暂无数据'}
        </div>
      )}
    </div>
  );
}
