import type { GpuAllocationSummary } from '@monitor/core';

interface Props {
  allocation?: GpuAllocationSummary;
}

interface Segment {
  key: string;
  label: string;
  value: number;
  className: string;
}

export function GpuAllocationBars({ allocation }: Props) {
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
                <span>{gpu.totalMemoryMB} MB</span>
              </div>
              <div className="flex h-3 overflow-hidden rounded-full bg-dark-bg border border-dark-border/70">
                {segments.filter((segment) => segment.value > 0).map((segment) => (
                  <div
                    key={segment.key}
                    className={segment.className}
                    style={{ width: `${(segment.value / totalMB) * 100}%` }}
                    title={`${segment.label}: ${segment.value} MB`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-500">
                {segments.map((segment) => (
                  <span key={segment.key}>{segment.label} {segment.value} MB</span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}