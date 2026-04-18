import type { UnifiedReport } from '../../../transport/types.js';
import { formatBytesPerSecond } from '../../../utils/rates.js';
import type { GpuTotals } from '../utils/gpu.js';
import { StatCard } from './StatCard.js';
import { DiskUsageBars } from './DiskUsageBars.js';

export function RealtimeStateSection({ snap, gpuTotals }: { snap: UnifiedReport['resourceSnapshot']; gpuTotals: GpuTotals }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="CPU" value={`${snap.cpu.usagePercent.toFixed(1)}%`} sub={`${snap.cpu.coreCount} 核 ${snap.cpu.frequencyMhz} MHz`} />
        <StatCard label="内存" value={`${snap.memory.usagePercent.toFixed(1)}%`} sub={`${(snap.memory.usedMb / 1024).toFixed(1)} / ${(snap.memory.totalMb / 1024).toFixed(1)} GB`} />
        <StatCard label="网络" value={`↓${formatBytesPerSecond(snap.network.rxBytesPerSec)} ↑${formatBytesPerSecond(snap.network.txBytesPerSec)}`} sub={`${snap.network.interfaces.length} 接口`} />
        <StatCard label="GPU 总览" value={`${gpuTotals.averageUtilization.toFixed(1)}%`} sub={`VRAM ${gpuTotals.totalVramPercent.toFixed(1)}%`} />
      </div>
      <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
        <h3 className="mb-3 text-sm font-medium text-slate-300">磁盘使用情况</h3>
        <DiskUsageBars disks={snap.disks} />
      </div>
    </div>
  );
}
