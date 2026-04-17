import { useState } from 'react';
import type { GpuCardReport } from '../transport/types.js';
import { formatVramGB } from '../utils/vram.js';
import { getOwnerColor } from '../utils/ownerColor.js';

interface Props {
  gpu: GpuCardReport;
}

export function GpuBar({ gpu }: Props) {
  const [showTooltip, setShowTooltip] = useState(false);
  const total = gpu.memoryTotalMb;
  if (total <= 0) return null;

  const segments: { label: string; mb: number; color: string; tooltip: string }[] = [];

  // Managed task allocations
  for (const alloc of gpu.taskAllocations) {
    segments.push({
      label: alloc.taskId.slice(0, 8),
      mb: alloc.declaredVramMb,
      color: getOwnerColor(alloc.taskId, 'task'),
      tooltip: `任务 ${alloc.taskId.slice(0, 8)}: ${formatVramGB(alloc.declaredVramMb)}`,
    });
  }

  // Unmanaged
  if (gpu.unmanagedPeakMb > 0) {
    segments.push({
      label: 'unmanaged',
      mb: gpu.unmanagedPeakMb,
      color: '#64748b',
      tooltip: `未管理: ${formatVramGB(gpu.unmanagedPeakMb)}`,
    });
  }

  const usedMb = segments.reduce((sum, s) => sum + s.mb, 0);
  const freeMb = Math.max(0, total - usedMb);

  return (
    <div className="space-y-1" onMouseEnter={() => setShowTooltip(true)} onMouseLeave={() => setShowTooltip(false)}>
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span className="font-mono">GPU {gpu.index}: {gpu.name}</span>
        <span className="text-slate-600">|</span>
        <span>{gpu.temperature}°C</span>
        <span className="text-slate-600">|</span>
        <span>利用率 {gpu.utilizationGpu}%</span>
      </div>

      <div className="flex h-5 w-full overflow-hidden rounded-full bg-dark-bg border border-dark-border">
        {segments.map((seg, i) => (
          <div
            key={i}
            className="h-full transition-all duration-300"
            style={{ width: `${(seg.mb / total) * 100}%`, backgroundColor: seg.color }}
            title={seg.tooltip}
          />
        ))}
        {freeMb > 0 && (
          <div className="h-full flex-1" title={`空闲: ${formatVramGB(freeMb)}`} />
        )}
      </div>

      <div className="flex justify-between text-[10px] text-slate-500 font-mono">
        <span>已用 {formatVramGB(gpu.memoryUsedMb)}</span>
        <span>调度可用 {formatVramGB(gpu.effectiveFreeMb)}</span>
        <span>总计 {formatVramGB(total)}</span>
      </div>

      {showTooltip && (gpu.userProcesses.length > 0 || gpu.unknownProcesses.length > 0) && (
        <div className="mt-1 rounded-lg border border-dark-border bg-dark-card p-2 text-xs space-y-1">
          {gpu.userProcesses.map((p, i) => (
            <div key={i} className="flex justify-between text-slate-300">
              <span>{p.user} (PID {p.pid})</span>
              <span className="text-accent-blue">{formatVramGB(p.vramMb)}</span>
            </div>
          ))}
          {gpu.unknownProcesses.map((p, i) => (
            <div key={`u-${i}`} className="flex justify-between text-slate-500">
              <span>未知 (PID {p.pid})</span>
              <span>{formatVramGB(p.vramMb)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
