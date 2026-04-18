import type { SnapshotWithGpu } from '../../../transport/types.js';
import { formatBytesPerSecond } from '../../../utils/rates.js';
import { StatCard } from './StatCard.js';
import { DiskUsageBars } from './DiskUsageBars.js';

export function SnapshotSummary({ snapshot }: { snapshot: SnapshotWithGpu }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="CPU" value={`${snapshot.cpu.usagePercent.toFixed(1)}%`} sub={`${snapshot.cpu.coreCount} 核`} />
        <StatCard label="内存" value={`${snapshot.memory.usagePercent.toFixed(1)}%`} sub={`${(snapshot.memory.usedMb / 1024).toFixed(1)} GB 已用`} />
        <StatCard label="网络" value={`↓${formatBytesPerSecond(snapshot.network.rxBytesPerSec)} ↑${formatBytesPerSecond(snapshot.network.txBytesPerSec)}`} sub={`${snapshot.network.interfaces.length} 接口`} />
        <StatCard label="GPU" value={`${snapshot.gpuCards.length} 卡`} sub={`${snapshot.processes.length} 个进程`} />
      </div>
      <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
        <h3 className="mb-3 text-sm font-medium text-slate-300">磁盘使用情况</h3>
        <DiskUsageBars disks={snapshot.disks} />
      </div>
    </div>
  );
}
