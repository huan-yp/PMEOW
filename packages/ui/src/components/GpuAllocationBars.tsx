import type { GpuAllocationSummary, ResolvedGpuAllocationResponse } from '@monitor/core';
import { formatVramGB } from '../utils/vram.js';

interface Props {
  allocation?: GpuAllocationSummary;
  resolved?: ResolvedGpuAllocationResponse | null;
}

interface Segment {
  key: string;
  label: string;
  value: number;
  className?: string;
  style?: React.CSSProperties;
}

const OWNER_PALETTE = [
  '#3b82f6', '#10b981', '#8b5cf6', '#f97316', '#06b6d4',
  '#ec4899', '#14b8a6', '#a855f7', '#f59e0b', '#6366f1',
];
const FREE_COLOR = 'rgb(51, 65, 85)'; // slate-700
const UNKNOWN_COLOR = '#f59e0b'; // amber-500

function hashOwnerKey(ownerKey: string): number {
  let hash = 0;
  for (let i = 0; i < ownerKey.length; i++) {
    hash = ((hash << 5) - hash + ownerKey.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getOwnerColor(ownerKey: string, ownerKind: string): string {
  if (ownerKind === 'unknown') return UNKNOWN_COLOR;
  return OWNER_PALETTE[hashOwnerKey(ownerKey) % OWNER_PALETTE.length];
}

export function GpuAllocationBars({ allocation, resolved }: Props) {
  if (resolved && resolved.perGpu.length > 0) {
    return (
      <div className="rounded-lg border border-dark-border bg-dark-card p-4">
        <h3 className="text-sm text-slate-300 mb-3">GPU 分配</h3>
        <div className="space-y-3">
          {resolved.perGpu.map((gpu) => {
            const totalMB = gpu.totalMemoryMB || 1;
            const segments: Segment[] = gpu.segments.map((seg) => ({
              key: seg.ownerKey,
              label: seg.displayName,
              value: seg.usedMemoryMB,
              style: { backgroundColor: getOwnerColor(seg.ownerKey, seg.ownerKind) },
            }));
            const freeMB = Math.max(gpu.freeMB, 0);
            segments.push({ key: 'free', label: 'Free', value: freeMB, style: { backgroundColor: FREE_COLOR } });

            return (
              <div key={gpu.gpuIndex}>
                <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                  <span>GPU {gpu.gpuIndex}</span>
                  <span>{formatVramGB(gpu.totalMemoryMB)}</span>
                </div>
                <div className="flex h-3 overflow-hidden rounded-full bg-dark-bg border border-dark-border/70">
                  {segments.filter((s) => s.value > 0).map((s) => (
                    <div
                      key={s.key}
                      style={{ width: `${(s.value / totalMB) * 100}%`, ...s.style }}
                      title={`${s.label}: ${formatVramGB(s.value)}`}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-500">
                  {segments.map((s) => (
                    <span key={s.key} className="flex items-center gap-1">
                      <span className="inline-block h-2 w-2 rounded-full" style={s.style} />
                      {s.label} {formatVramGB(s.value)}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (!allocation || allocation.perGpu.length === 0) {
    return (
      <div className="rounded-lg border border-dark-border bg-dark-card p-4">
        <h3 className="text-sm text-slate-300 mb-2">GPU 分配</h3>
        <p className="text-sm text-slate-500">暂无 GPU 分配数据</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-dark-border bg-dark-card p-4">
      <h3 className="text-sm text-slate-300 mb-3">GPU 分配</h3>
      <div className="space-y-3">
        {allocation.perGpu.map((gpu) => {
          const taskMB = gpu.pmeowTasks.reduce((sum, item) => sum + item.actualVramMB, 0);
          const userMB = gpu.userProcesses.reduce((sum, item) => sum + item.usedMemoryMB, 0);
          const unknownMB = gpu.unknownProcesses.reduce((sum, item) => sum + item.usedMemoryMB, 0);
          const freeMB = Math.max(gpu.effectiveFreeMB, 0);
          const totalMB = gpu.totalMemoryMB || 1;
          const segments: Segment[] = [
            { key: 'task', label: 'Task', value: taskMB, className: 'bg-accent-blue' },
            { key: 'user', label: 'User', value: userMB, className: 'bg-accent-green' },
            { key: 'unknown', label: 'Unknown', value: unknownMB, className: 'bg-accent-yellow' },
            { key: 'free', label: 'Free', value: freeMB, className: 'bg-slate-700' },
          ];

          return (
            <div key={gpu.gpuIndex}>
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>GPU {gpu.gpuIndex}</span>
                <span>{formatVramGB(gpu.totalMemoryMB)}</span>
              </div>
              <div className="flex h-3 overflow-hidden rounded-full bg-dark-bg border border-dark-border/70">
                {segments.filter((segment) => segment.value > 0).map((segment) => (
                  <div
                    key={segment.key}
                    className={segment.className}
                    style={{ width: `${(segment.value / totalMB) * 100}%` }}
                    title={`${segment.label}: ${formatVramGB(segment.value)}`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-500">
                {segments.map((segment) => (
                  <span key={segment.key}>{segment.label} {formatVramGB(segment.value)}</span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}