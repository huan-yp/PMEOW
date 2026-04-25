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
  const diskSummary = summarizeDisks(snap?.disks ?? []);

  // Network aggregate
  const totalRx = snap?.network.rxBytesPerSec ?? 0;
  const totalTx = snap?.network.txBytesPerSec ?? 0;

  // Internet status
  const internetVisual = getInternetStatusVisual(getInternetReachabilityState(snap?.network.internetReachable));

  return (
    <div
      onClick={() => navigate(`/nodes/${server.id}`, { state: { returnTo: '/', returnLabel: '返回控制台' } })}
      className={`node-surface-shell node-card-shell ${connectionVisual.surfaceClassName} cursor-pointer rounded-[26px] p-4 sm:p-5`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-semibold tracking-tight text-slate-50 sm:text-xl">{server.name}</h3>
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
        <p className="mb-3 truncate text-sm text-slate-400">
          {[
            status?.version ? `v${status.version}` : null,
            isStale && status?.lastSeenAt ? `最后上报 ${formatLastSeen(status.lastSeenAt)}` : null,
          ].filter(Boolean).join(' · ')}
        </p>
      )}
      {!snap && <p className="mb-4 truncate text-sm text-slate-400">等待节点指标上报</p>}

      {(queuedCount > 0 || runningCount > 0) && (
        <div className="mb-3 rounded-2xl border border-cyan-400/10 bg-cyan-500/[0.07] px-3 py-2 text-xs text-cyan-50/90">
          排队 {queuedCount} / 运行中 {runningCount}
        </div>
      )}

      {snap ? (
        <div className={`space-y-3 ${isStale ? 'opacity-50' : ''}`}>
          <div className="grid gap-3 2xl:grid-cols-2">
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
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
              value={diskSummary ? `${diskSummary.usagePercent.toFixed(1)}%` : 'N/A'}
              sub={diskSummary ? `${diskSummary.label} · ${diskSummary.usedGB.toFixed(1)}/${diskSummary.totalGB.toFixed(1)} GB` : '暂无磁盘数据'}
              tone={getUsageTone(diskSummary?.usagePercent ?? 0)}
              icon={<MetricGlyph kind="disk" tone={getUsageTone(diskSummary?.usagePercent ?? 0)} />}
              barValue={diskSummary?.usagePercent ?? 0}
              barCaption={diskSummary ? `已用 ${diskSummary.usedGB.toFixed(1)}/${diskSummary.totalGB.toFixed(1)} GB` : '暂无磁盘数据'}
            />
            <SummaryMetricCard
              label="网络"
              value={`↓${formatBytesPerSecond(totalRx)} ↑${formatBytesPerSecond(totalTx)}`}
              sub={`${snap.network.interfaces.length} 个接口`}
              tone="network"
              icon={<MetricGlyph kind="network" tone="network" />}
              valueClassName="text-[1.15rem] sm:text-[1.3rem]"
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
    ? 'rounded-[22px] border border-white/10 bg-slate-950/35 p-4 backdrop-blur-sm'
    : 'rounded-[20px] border border-white/8 bg-slate-950/22 p-3.5';
  const valueClass = props.valueClassName ?? (featured ? 'text-[2rem] sm:text-[2.15rem]' : 'text-[1.55rem] sm:text-[1.7rem]');

  return (
    <div className={cardClass}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            {props.icon}
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 sm:text-sm">{props.label}</p>
          </div>
          <p className={`mt-3 font-mono font-semibold tracking-tight text-slate-50 ${valueClass}`}>{props.value}</p>
          <div className={`mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 ${featured ? 'text-sm' : 'text-[13px]'}`}>
            <p className="leading-5 text-slate-300">{props.sub}</p>
            {props.gaugeCaption ? <p className="leading-5 text-slate-500">{props.gaugeCaption}</p> : null}
          </div>
        </div>
        {typeof props.gaugeValue === 'number' && (
          <div className="hidden shrink-0 md:block">
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
  const barTone = getUsageTone(clamped);
  const barPresentation = getBarPresentation(barTone);

  return (
    <div className="mt-3 space-y-1.5">
      <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-900/80 ring-1 ring-white/6">
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all duration-300 ${barPresentation.fillClass}`}
          style={{ width: `${clamped}%` }}
        />
        <div className="absolute inset-y-0 left-[60%] w-px bg-slate-950/80" />
        <div className="absolute inset-y-0 left-[90%] w-px bg-slate-950/80" />
      </div>
      <div className="flex items-center justify-between gap-3 text-[10px] text-slate-500 sm:text-[11px]">
        <span className="truncate">{caption}</span>
        <span>60% / 90%</span>
      </div>
    </div>
  );
}

function SemiGauge({ value, tone }: { value: number; tone: SummaryTone }) {
  const clamped = clampPercent(value);
  const toneMap = getTonePresentation(tone);

  return (
    <div className="flex flex-col items-center justify-center">
      <svg viewBox="0 0 100 60" className="h-20 w-28 overflow-visible xl:h-24 xl:w-32">
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
      </svg>
      <span className={`-mt-4 text-[11px] font-semibold uppercase tracking-[0.22em] ${toneMap.textClass}`}>{toneMap.label}</span>
    </div>
  );
}

function MetricGlyph({ kind, tone }: { kind: 'cpu' | 'memory' | 'disk' | 'network' | 'gpu' | 'vram'; tone: SummaryTone }) {
  const toneMap = getTonePresentation(tone);

  return (
    <span className={`flex h-10 w-10 items-center justify-center rounded-2xl border ${toneMap.badgeClass}`}>
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
  if (value >= 60) return 'warn';
  return 'good';
}

function getBarPresentation(tone: SummaryTone) {
  switch (tone) {
    case 'danger':
      return {
        fillClass: 'bg-red-400/95 shadow-[0_0_18px_rgba(248,113,113,0.3)]',
      };
    case 'warn':
      return {
        fillClass: 'bg-amber-400/95 shadow-[0_0_18px_rgba(251,191,36,0.28)]',
      };
    case 'good':
    case 'network':
    default:
      return {
        fillClass: 'bg-emerald-400/95 shadow-[0_0_18px_rgba(52,211,153,0.24)]',
      };
  }
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

function summarizeDisks(disks: NonNullable<UnifiedReport['resourceSnapshot']>['disks']): {
  label: string;
  totalGB: number;
  usedGB: number;
  usagePercent: number;
} | null {
  if (disks.length === 0) return null;

  const totalGB = disks.reduce((sum, disk) => sum + disk.totalGB, 0);
  const usedGB = disks.reduce((sum, disk) => sum + disk.usedGB, 0);
  const usagePercent = totalGB > 0 ? (usedGB / totalGB) * 100 : 0;
  const label = disks.length === 1 ? disks[0].mountPoint : `${disks.length} 个挂载点`;

  return { label, totalGB, usedGB, usagePercent };
}

function averageGpuMemoryBandwidth(gpuCards: NonNullable<UnifiedReport['resourceSnapshot']>['gpuCards']): number {
  if (gpuCards.length === 0) return 0;
  return gpuCards.reduce((sum, gpu) => sum + gpu.utilizationMemory, 0) / gpuCards.length;
}
