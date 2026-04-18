import { ProcessTable } from '../../../components/ProcessTable.js';
import type { SnapshotWithGpu } from '../../../transport/types.js';

export function ProcessesTab({ processes }: { processes: SnapshotWithGpu['processes'] }) {
  return (
    <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
      <ProcessTable processes={processes} />
    </div>
  );
}
