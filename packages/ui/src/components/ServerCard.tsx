import { useNavigate } from 'react-router-dom';
import type { Server, ServerStatus, UnifiedReport } from '../transport/types.js';
import { ProgressBar } from './ProgressBar.js';
import { useStore } from '../store/useStore.js';
import { formatBytesPerSecond } from '../utils/rates.js';
import { formatVramPairGB } from '../utils/vram.js';
import { getConnectionStatusVisual } from '../utils/nodeStatus.js';

function getGpuUtilTextClass(utilizationPercent: number) {
  if (utilizationPercent >= 90) return 'text-accent-red';
  if (utilizationPercent >= 10) return 'text-accent-yellow';
  return 'text-accent-green';
}

interface Props {
  server: Server;
  status?: ServerStatus;
  report?: UnifiedReport;
}

function formatLastSeen(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

export function ServerCard({ server, status, report }: Props) {
  const navigate = useNavigate();
  const connStatus = status?.status ?? 'offline';
  const isStale = connStatus !== 'online' && report !== undefined;
  const statusVisual = getConnectionStatusVisual(connStatus);
  const snap = report?.resourceSnapshot;

  // Task counts from the live report
  const queuedCount = report?.taskQueue?.queued?.length ?? 0;
  const runningCount = report?.taskQueue?.running?.length ?? 0;

  // GPU aggregates
  const gpuCards = snap?.gpuCards ?? [];
  const hasGpu = gpuCards.length > 0;
  const avgGpuUtil = hasGpu ? gpuCards.reduce((s, g) => s + g.utilizationGpu, 0) / gpuCards.length : 0;
  const totalVram = gpuCards.reduce((s, g) => s + g.memoryTotalMb, 0);
  const usedVram = gpuCards.reduce((s, g) => s + g.memoryUsedMb, 0);
  const vramPercent = totalVram > 0 ? (usedVram / totalVram) * 100 : 0;

  // Network aggregate
  const totalRx = snap?.network?.reduce((s, n) => s + n.rxBytesPerSec, 0) ?? 0;
  const totalTx = snap?.network?.reduce((s, n) => s + n.txBytesPerSec, 0) ?? 0;

  // Internet status
  const internetReachable = snap?.internet?.reachable;
  const internetLabel = internetReachable === true ? '有外网' : internetReachable === false ? '无外网' : '未探测';
  const internetDot = internetReachable === true ? 'bg-emerald-300' : internetReachable === false ? 'bg-rose-300' : 'bg-slate-400';

  return (
    <div
      onClick={() => navigate(`/nodes/${server.id}`)}
      className={`node-surface-shell node-card-shell ${statusVisual.surfaceClassName} rounded-2xl p-5 cursor-pointer`}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-slate-100">{server.name}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`node-badge-base ${statusVisual.badgeClassName}`}>
              <span className={`h-2 w-2 rounded-full ${statusVisual.dotClassName}`} />
              {statusVisual.label}
            </span>
            <span className="node-badge-base node-badge-status-neutral">
              <span className={`h-2 w-2 rounded-full ${internetDot}`} />
              {internetLabel}
            </span>
          </div>
        </div>
      </div>

      {snap && (
        <p className="mb-3 truncate text-xs text-slate-500">
          Agent {server.agentId.slice(0, 8)}
          {status?.version ? ` · v${status.version}` : ''}
          {isStale && status?.lastSeenAt ? ` · 最后上报 ${formatLastSeen(status.lastSeenAt)}` : ''}
        </p>
      )}
      {!snap && <p className="mb-3 truncate text-xs text-slate-500">Agent {server.agentId.slice(0, 8)}</p>}

      {(queuedCount > 0 || runningCount > 0) && (
        <div className="mb-3 rounded-xl border border-cyan-400/10 bg-cyan-500/[0.07] px-3 py-2 text-xs text-cyan-50/90">
          排队 {queuedCount} / 运行中 {runningCount}
        </div>
      )}

      {snap ? (
        <div className={isStale ? 'opacity-50' : ''}>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-slate-500">CPU</span>
              <p className="mt-0.5 font-mono text-slate-300">{snap.cpu.usage.toFixed(1)}%</p>
            </div>
            <div>
              <span className="text-slate-500">内存</span>
              <p className="mt-0.5 font-mono text-slate-300">{snap.memory.percent.toFixed(1)}%</p>
            </div>
            <div>
              <span className="text-slate-500">磁盘</span>
              <p className="mt-0.5 font-mono text-slate-300">
                {snap.disks[0] ? `${((snap.disks[0].usedMb / snap.disks[0].totalMb) * 100).toFixed(0)}%` : 'N/A'}
              </p>
            </div>
            <div>
              <span className="text-slate-500">网络</span>
              <p className="mt-0.5 font-mono text-slate-300">
                ↓{formatBytesPerSecond(totalRx)} ↑{formatBytesPerSecond(totalTx)}
              </p>
            </div>
            {hasGpu && (
              <div className="col-span-2">
                <span className="text-slate-500">GPU 利用率</span>
                <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className={`font-mono ${getGpuUtilTextClass(avgGpuUtil)}`}>
                    {avgGpuUtil.toFixed(0)}%
                  </p>
                  <p className="font-mono text-[11px] font-medium tracking-tight text-slate-400">
                    VRAM {formatVramPairGB(usedVram, totalVram)}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="mt-3 space-y-1.5 border-t border-dark-border pt-3">
            {hasGpu && <ProgressBar label="VRAM" value={vramPercent} />}
            <ProgressBar label="内存" value={snap.memory.percent} />
          </div>
        </div>
      ) : (
        <div className="flex h-32 items-center justify-center text-sm text-slate-600">
          {connStatus === 'online' ? '等待数据...' : '暂无数据'}
        </div>
      )}
    </div>
  );
}
