import type { GpuAllocationSummary, ResolvedGpuAllocationResponse } from '@monitor/core';
import { formatVramGB } from '../utils/vram.js';
import { getOwnerColor, FREE_COLOR, UNATTRIBUTED_COLOR } from '../utils/ownerColor.js';

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

function buildSegments(
  totalMemoryMB: number,
  baseSegments: Segment[],
  reportedUsedMB?: number,
  reportedFreeMB?: number,
): Segment[] {
  const segments = [...baseSegments];

  if (reportedFreeMB !== undefined) {
    segments.push({
      key: 'free',
      label: 'Free',
      value: Math.max(reportedFreeMB, 0),
      style: { backgroundColor: FREE_COLOR },
    });
    return segments;
  }

  const attributedUsedMB = segments.reduce((sum, segment) => sum + segment.value, 0);
  const actualUsedMB = Math.max(reportedUsedMB ?? 0, attributedUsedMB);
  const unattributedMB = Math.max(actualUsedMB - attributedUsedMB, 0);

  if (unattributedMB > 0) {
    segments.push({
      key: 'unattributed',
      label: 'Unattributed',
      value: unattributedMB,
      style: { backgroundColor: UNATTRIBUTED_COLOR },
    });
  }

  segments.push({
    key: 'free',
    label: 'Free',
    value: Math.max(totalMemoryMB - actualUsedMB, 0),
    style: { backgroundColor: FREE_COLOR },
  });

  return segments;
}

export function GpuAllocationBars({ allocation, resolved }: Props) {
  if (resolved && resolved.perGpu.length > 0) {
    return (
      <div className="rounded-lg border border-dark-border bg-dark-card p-4">
        <h3 className="text-sm text-slate-300 mb-3">GPU 分配</h3>
        <div className="space-y-3">
          {resolved.perGpu.map((gpu) => {
            const totalMB = gpu.totalMemoryMB || 1;
            const segments = buildSegments(gpu.totalMemoryMB, gpu.segments.map((seg) => ({
              key: seg.ownerKey,
              label: seg.displayName,
              value: seg.usedMemoryMB,
              style: { backgroundColor: getOwnerColor(seg.ownerKey, seg.ownerKind) },
            })), undefined, gpu.freeMB);

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
          const totalMB = gpu.totalMemoryMB || 1;
          const segments = buildSegments(gpu.totalMemoryMB, [
            { key: 'task', label: 'Task', value: taskMB, className: 'bg-accent-blue' },
            { key: 'user', label: 'User', value: userMB, className: 'bg-accent-green' },
            { key: 'unknown', label: 'Unknown', value: unknownMB, className: 'bg-accent-yellow' },
          ], gpu.usedMemoryMB);

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