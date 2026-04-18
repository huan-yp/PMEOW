import type { GpuAllocationLegendModel } from '../utils/gpu.js';
import { formatVramGB } from '../../../utils/vram.js';
import { UNKNOWN_COLOR } from '../../../utils/ownerColor.js';

export function GpuAllocationLegend({ model }: { model: GpuAllocationLegendModel }) {
  if (model.owners.length === 0 && model.unknownTotalMb <= 0 && !model.note) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-2xl border border-dark-border bg-dark-bg/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-medium uppercase tracking-[0.12em] text-slate-400">用户颜色说明</h4>
        <span className="text-[11px] text-slate-500">同一用户跨 GPU 只显示一次</span>
      </div>

      {model.note && (
        <div className="rounded-xl border border-dark-border bg-dark-card/70 px-3 py-2 text-[11px] text-slate-400">
          {model.note}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {model.owners.map((owner) => (
          <div key={owner.key} className="flex items-center justify-between gap-3 rounded-xl border border-dark-border/80 bg-dark-card/70 px-3 py-2 text-sm text-slate-200">
            <div className="inline-flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: owner.baseColor }} />
              <span className="truncate">{owner.label}</span>
            </div>
            <span className="shrink-0 font-mono text-xs text-slate-400">{formatVramGB(owner.managedReservedMb + owner.unmanagedMb)}</span>
          </div>
        ))}

        {model.unknownTotalMb > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-dark-border/80 bg-dark-card/70 px-3 py-2 text-sm text-slate-200">
            <div className="inline-flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: UNKNOWN_COLOR }} />
              <span className="truncate">未知进程</span>
            </div>
            <span className="shrink-0 font-mono text-xs text-slate-400">{formatVramGB(model.unknownTotalMb)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
