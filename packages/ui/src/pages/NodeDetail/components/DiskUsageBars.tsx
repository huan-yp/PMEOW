import type { SnapshotWithGpu } from '../../../transport/types.js';

export function DiskUsageBars({ disks }: { disks: SnapshotWithGpu['disks'] }) {
  if (disks.length === 0) {
    return <div className="text-sm text-slate-500">暂无磁盘数据</div>;
  }

  return (
    <div className="space-y-3">
      {disks.map((disk) => (
        <div key={`${disk.filesystem}-${disk.mountPoint}`} className="space-y-1.5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-slate-200">{disk.mountPoint}</span>
            <span className="text-xs text-slate-500">{disk.usedGB.toFixed(1)} / {disk.totalGB.toFixed(1)} GB</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-dark-bg">
            <div
              className={`h-full rounded-full ${disk.usagePercent >= 90 ? 'bg-accent-red' : disk.usagePercent >= 70 ? 'bg-accent-yellow' : 'bg-accent-green'}`}
              style={{ width: `${Math.max(0, Math.min(100, disk.usagePercent))}%` }}
            />
          </div>
          <div className="text-xs text-slate-500">{disk.filesystem} · {disk.usagePercent.toFixed(1)}%</div>
        </div>
      ))}
    </div>
  );
}
