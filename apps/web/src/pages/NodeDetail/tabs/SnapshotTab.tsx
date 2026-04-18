import { useMemo } from 'react';
import { SnapshotTimePicker } from '../../../components/SnapshotTimePicker.js';
import { GpuBar } from '../../../components/GpuBar.js';
import { ProcessTable } from '../../../components/ProcessTable.js';
import type { SnapshotWithGpu } from '../../../transport/types.js';
import { buildGpuAllocationLegendModel } from '../utils/gpu.js';
import { SnapshotSummary } from '../components/SnapshotSummary.js';
import { GpuAllocationLegend } from '../components/GpuAllocationLegend.js';

interface SnapshotTabProps {
  snapshotTimeline: SnapshotWithGpu[];
  selectedSnapshotTs: number | null;
  selectedSnapshot: SnapshotWithGpu | undefined;
  snapshotLoading: boolean;
  onSelectSnapshot: (ts: number | null) => void;
}

export function SnapshotTab({
  snapshotTimeline,
  selectedSnapshotTs,
  selectedSnapshot,
  snapshotLoading,
  onSelectSnapshot,
}: SnapshotTabProps) {
  const snapshotGpuAllocation = useMemo(
    () => buildGpuAllocationLegendModel(selectedSnapshot?.gpuCards ?? [], undefined, true),
    [selectedSnapshot],
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
        {snapshotLoading ? (
          <div className="text-center text-sm text-slate-500 py-8">加载中...</div>
        ) : (
          <SnapshotTimePicker
            snapshots={snapshotTimeline}
            selectedTimestamp={selectedSnapshotTs}
            onSelect={onSelectSnapshot}
          />
        )}
      </div>

      {selectedSnapshot ? (
        <>
          <SnapshotSummary snapshot={selectedSnapshot} />
          {selectedSnapshot.gpuCards.length > 0 && (
            <div className="rounded-2xl border border-dark-border bg-dark-card p-4 space-y-4">
              <h3 className="text-sm font-medium text-slate-300">GPU 显存分配</h3>
              {selectedSnapshot.gpuCards.map((gpu) => <GpuBar key={`snapshot-${gpu.index}`} gpu={gpu} historical />)}
              <GpuAllocationLegend model={snapshotGpuAllocation} />
            </div>
          )}
          <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
            <h3 className="mb-3 text-sm font-medium text-slate-300">快照进程列表</h3>
            <ProcessTable processes={selectedSnapshot.processes} />
          </div>
        </>
      ) : (
        !snapshotLoading && (
          <div className="rounded-2xl border border-dark-border bg-dark-card px-4 py-8 text-center text-sm text-slate-500">
            暂无可回放的历史快照。
          </div>
        )
      )}
    </div>
  );
}
