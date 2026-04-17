import { useNavigate } from 'react-router-dom';
import type { Server, ServerStatus, UnifiedReport } from '../transport/types.js';
import { formatBytesPerSecond } from '../utils/rates.js';
import { formatMemoryPairGB, formatVramPairGB } from '../utils/vram.js';
import { getConnectionStatusVisual, getInternetReachabilityState, getInternetStatusVisual } from '../utils/nodeStatus.js';

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
  const connectionVisual = getConnectionStatusVisual(connStatus);
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
  const primaryDisk = snap?.disks[0];

  // Network aggregate
  const totalRx = snap?.network.rxBytesPerSec ?? 0;
  const totalTx = snap?.network.txBytesPerSec ?? 0;

  // Internet status
  const internetVisual = getInternetStatusVisual(getInternetReachabilityState(snap?.network.internetReachable));

  return (
    <div
      onClick={() => navigate(`/nodes/${server.id}`, { state: { returnTo: '/', returnLabel: '返回控制台' } })}
      className={`node-surface-shell node-card-shell ${connectionVisual.surfaceClassName} cursor-pointer rounded-[28px] p-5 sm:p-6`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-xl font-semibold tracking-tight text-slate-50">{server.name}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`node-badge-base ${connectionVisual.badgeClassName}`}>
              <span className={`h-2 w-2 rounded-full ${connectionVisual.dotClassName}`} />
              {connectionVisual.label}
            </span>
            <span className={`node-badge-base ${internetVisual.badgeClassName}`}>
              <span className={`h-2 w-2 rounded-full ${internetVisual.dotClassName}`} />
              {internetVisual.label}
            </span>
            <span className="node-badge-base node-badge-source-agent">Agent {server.agentId.slice(0, 8)}</span>
          </div>
        </div>
      </div>

      {snap && (
        <p className="mb-4 truncate text-sm text-slate-400">
          {[
            status?.version ? `v${status.version}` : null,
            isStale && status?.lastSeenAt ? `最后上报 ${formatLastSeen(status.lastSeenAt)}` : null,
          ].filter(Boolean).join(' · ')}
        </p>
      )}
      {!snap && <p className="mb-4 truncate text-sm text-slate-400">等待节点指标上报</p>}

      {(queuedCount > 0 || runningCount > 0) && (
        <div className="mb-4 rounded-2xl border border-cyan-400/10 bg-cyan-500/[0.07] px-3 py-2 text-xs text-cyan-50/90">
          排队 {queuedCount} / 运行中 {runningCount}
        </div>
      )}

      {snap ? (
        <div className={`space-y-4 ${isStale ? 'opacity-50' : ''}`}>
          <div className="grid gap-4 xl:grid-cols-2">
            <SummaryMetricCard
              label="GPU 占用率"
              value={hasGpu ? `${avgGpuUtil.toFixed(1)}%` : 'N/A'}
              sub={hasGpu ? `${gpuCards.length} 张 GPU 在线` : '未检测到 GPU'}
              tone={getUsageTone(avgGpuUtil)}
              gaugeValue={hasGpu ? avgGpuUtil : 0}
              gaugeCaption={hasGpu ? `显存带宽均值 ${averageGpuMemoryBandwidth(gpuCards).toFixed(0)}%` : '暂无显卡数据'}
              icon={<MetricGlyph kind="gpu" tone={getUsageTone(avgGpuUtil)} />}
              size="featured"
            />
            <SummaryMetricCard
              label="VRAM 占用率"
              value={hasGpu ? `${vramPercent.toFixed(1)}%` : 'N/A'}
              sub={hasGpu ? formatVramPairGB(usedVram, totalVram) : '暂无显存数据'}
              tone={getUsageTone(vramPercent)}
              gaugeValue={hasGpu ? vramPercent : 0}
              gaugeCaption={hasGpu ? `已用 ${formatVramPairGB(usedVram, totalVram)}` : '无 GPU 资源'}
              icon={<MetricGlyph kind="vram" tone={getUsageTone(vramPercent)} />}
              size="featured"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
            <SummaryMetricCard
              label="CPU"
              value={`${snap.cpu.usagePercent.toFixed(1)}%`}
              sub={`${snap.cpu.coreCount} 核 · ${snap.cpu.frequencyMhz.toFixed(1)} MHz`}
              tone={getUsageTone(snap.cpu.usagePercent)}
              icon={<MetricGlyph kind="cpu" tone={getUsageTone(snap.cpu.usagePercent)} />}
              barValue={snap.cpu.usagePercent}
              barCaption={`${snap.cpu.coreCount} 核 · ${snap.cpu.frequencyMhz.toFixed(1)} MHz`}
            />
            <SummaryMetricCard
              label="内存"
              value={`${snap.memory.usagePercent.toFixed(1)}%`}
              sub={formatMemoryPairGB(snap.memory.usedMb, snap.memory.totalMb)}
              tone={getUsageTone(snap.memory.usagePercent)}
              icon={<MetricGlyph kind="memory" tone={getUsageTone(snap.memory.usagePercent)} />}
              barValue={snap.memory.usagePercent}
              barCaption={`已用 ${formatMemoryPairGB(snap.memory.usedMb, snap.memory.totalMb)}`}
            />
            <SummaryMetricCard
              label="磁盘"
              value={primaryDisk ? `${primaryDisk.usagePercent.toFixed(1)}%` : 'N/A'}
              sub={primaryDisk ? `${primaryDisk.mountPoint} · ${primaryDisk.usedGB.toFixed(1)}/${primaryDisk.totalGB.toFixed(1)} GB` : '暂无磁盘数据'}
              tone={getUsageTone(primaryDisk?.usagePercent ?? 0)}
              icon={<MetricGlyph kind="disk" tone={getUsageTone(primaryDisk?.usagePercent ?? 0)} />}
              barValue={primaryDisk?.usagePercent ?? 0}
              barCaption={primaryDisk ? `已用 ${primaryDisk.usedGB.toFixed(1)}/${primaryDisk.totalGB.toFixed(1)} GB` : '暂无磁盘数据'}
            />
            <SummaryMetricCard
              label="网络"
              value={`↓${formatBytesPerSecond(totalRx)} ↑${formatBytesPerSecond(totalTx)}`}
              sub={`${snap.network.interfaces.length} 个接口`}
              tone="network"
              icon={<MetricGlyph kind="network" tone="network" />}
              valueClassName="text-[1.3rem] sm:text-[1.45rem]"
            />
          </div>
        </div>
      ) : (
        <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-slate-500">
          {connStatus === 'online' ? '等待数据...' : '暂无数据'}
        </div>
      )}
    </div>
  );
}

type SummaryTone = 'good' | 'warn' | 'danger' | 'network';

function SummaryMetricCard(props: {
  label: string;
  value: string;
  sub: string;
  tone: SummaryTone;
  icon: React.ReactNode;
  size?: 'default' | 'featured';
  gaugeValue?: number;
  gaugeCaption?: string;
  valueClassName?: string;
  barValue?: number;
  barCaption?: string;
}) {
  const featured = props.size === 'featured';
  const cardClass = featured
    ? 'rounded-[24px] border border-white/10 bg-slate-950/35 p-4 backdrop-blur-sm'
    : 'rounded-[22px] border border-white/8 bg-slate-950/22 p-4';
  const valueClass = props.valueClassName ?? (featured ? 'text-3xl sm:text-[2.2rem]' : 'text-[1.85rem]');

  return (
    <div className={cardClass}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            {props.icon}
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-400">{props.label}</p>
          </div>
          <p className={`mt-4 font-mono font-semibold tracking-tight text-slate-50 ${valueClass}`}>{props.value}</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">{props.sub}</p>
          {props.gaugeCaption && <p className="mt-2 text-xs text-slate-500">{props.gaugeCaption}</p>}
        </div>
        {typeof props.gaugeValue === 'number' && (
          <div className="shrink-0">
            <SemiGauge value={props.gaugeValue} tone={props.tone} />
          </div>
        )}
      </div>
      {typeof props.barValue === 'number' && (
        <UsageGradientBar value={props.barValue} caption={props.barCaption ?? props.sub} />
      )}
    </div>
  );
}

function UsageGradientBar({ value, caption }: { value: number; caption: string }) {
  const clamped = clampPercent(value);

  return (
    <div className="mt-4 space-y-2">
      <div className="relative h-3 overflow-hidden rounded-full bg-slate-900/80 ring-1 ring-white/6">
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(52,211,153,0.95)_0%,rgba(52,211,153,0.95)_60%,rgba(251,191,36,0.95)_60%,rgba(251,191,36,0.95)_90%,rgba(248,113,113,0.98)_90%,rgba(248,113,113,0.98)_100%)]" />
        <div
          className="absolute inset-y-0 right-0 bg-slate-950/88 transition-all duration-300"
          style={{ width: `${100 - clamped}%` }}
        />
        <div className="absolute inset-y-0 left-[60%] w-px bg-slate-950/80" />
        <div className="absolute inset-y-0 left-[90%] w-px bg-slate-950/80" />
      </div>
      <div className="flex items-center justify-between gap-3 text-[11px] text-slate-500">
        <span>{caption}</span>
        <span>60% / 90%</span>
      </div>
    </div>
  );
}

function SemiGauge({ value, tone }: { value: number; tone: SummaryTone }) {
  const clamped = clampPercent(value);
  const angle = -90 + (clamped / 100) * 180;
  const radians = (angle * Math.PI) / 180;
  const x = 50 + 36 * Math.cos(radians);
  const y = 50 + 36 * Math.sin(radians);
  const toneMap = getTonePresentation(tone);

  return (
    <div className="flex flex-col items-center justify-center">
      <svg viewBox="0 0 100 60" className="h-24 w-32 overflow-visible">
        <path d="M14 50 A36 36 0 0 1 86 50" fill="none" stroke="rgba(71,85,105,0.32)" strokeWidth="10" strokeLinecap="round" />
        <path
          d="M14 50 A36 36 0 0 1 86 50"
          fill="none"
          stroke={toneMap.stroke}
          strokeWidth="10"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${clamped} 100`}
        />
        <circle cx={x} cy={y} r="4.5" fill={toneMap.stroke} stroke="rgba(15,23,42,0.9)" strokeWidth="2" />
      </svg>
      <span className={`-mt-4 text-xs font-semibold uppercase tracking-[0.22em] ${toneMap.textClass}`}>{toneMap.label}</span>
    </div>
  );
}

function MetricGlyph({ kind, tone }: { kind: 'cpu' | 'memory' | 'disk' | 'network' | 'gpu' | 'vram'; tone: SummaryTone }) {
  const toneMap = getTonePresentation(tone);

  return (
    <span className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${toneMap.badgeClass}`}>
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {kind === 'cpu' && <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M18 9h3M3 15h3M18 15h3M8 8h8v8H8z" />}
        {kind === 'memory' && <path d="M5 8h14v8H5zM8 12h.01M12 12h.01M16 12h.01M7 5v3M17 5v3M7 16v3M17 16v3" />}
        {kind === 'disk' && <path d="M4 6h16v12H4zM4 10h16M8 14h.01M12 14h5" />}
        {kind === 'network' && <path d="M7 7h10M7 17h10M14 4l3 3-3 3M10 14l-3 3 3 3" />}
        {kind === 'gpu' && <path d="M4 7h16v10H4zM8 11h8M8 14h5M7 4v3M12 4v3M17 4v3M7 17v3M12 17v3M17 17v3" />}
        {kind === 'vram' && <path d="M5 8h14v8H5zM8 12h8M9 5v3M15 5v3M9 16v3M15 16v3" />}
      </svg>
    </span>
  );
}

function getUsageTone(value: number): SummaryTone {
  if (value >= 90) return 'danger';
  if (value >= 70) return 'warn';
  return 'good';
}

function getTonePresentation(tone: SummaryTone) {
  switch (tone) {
    case 'danger':
      return {
        stroke: '#f87171',
        textClass: 'text-rose-300',
        badgeClass: 'border-rose-400/25 bg-rose-500/12 text-rose-200',
        label: '高负载',
      };
    case 'warn':
      return {
        stroke: '#fbbf24',
        textClass: 'text-amber-200',
        badgeClass: 'border-amber-400/25 bg-amber-500/12 text-amber-100',
        label: '偏高',
      };
    case 'network':
      return {
        stroke: '#38bdf8',
        textClass: 'text-sky-200',
        badgeClass: 'border-cyan-400/25 bg-cyan-500/12 text-cyan-100',
        label: '吞吐',
      };
    case 'good':
    default:
      return {
        stroke: '#34d399',
        textClass: 'text-emerald-200',
        badgeClass: 'border-emerald-400/25 bg-emerald-500/12 text-emerald-100',
        label: '稳定',
      };
  }
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function averageGpuMemoryBandwidth(gpuCards: NonNullable<UnifiedReport['resourceSnapshot']>['gpuCards']): number {
  if (gpuCards.length === 0) return 0;
  return gpuCards.reduce((sum, gpu) => sum + gpu.utilizationMemory, 0) / gpuCards.length;
}
