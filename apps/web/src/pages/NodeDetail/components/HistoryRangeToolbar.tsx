import type { HistoryPreset } from '../utils/types.js';
import { PRESET_LABELS } from '../utils/types.js';

export function HistoryRangeToolbar(props: {
  activePreset: HistoryPreset;
  customFrom: string;
  customTo: string;
  onPresetSelect: (preset: Exclude<HistoryPreset, 'custom'>) => void;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
  onApplyCustom: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {Object.entries(PRESET_LABELS).map(([preset, label]) => (
          <button
            key={preset}
            type="button"
            onClick={() => props.onPresetSelect(preset as Exclude<HistoryPreset, 'custom'>)}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${props.activePreset === preset ? 'border-accent-blue bg-accent-blue/10 text-accent-blue' : 'border-dark-border bg-dark-card text-slate-300 hover:text-slate-100'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
        <input
          type="datetime-local"
          value={props.customFrom}
          onChange={(e) => props.onCustomFromChange(e.target.value)}
          className="rounded-xl border border-dark-border bg-dark-bg px-3 py-2 text-sm text-slate-200 outline-none"
        />
        <input
          type="datetime-local"
          value={props.customTo}
          onChange={(e) => props.onCustomToChange(e.target.value)}
          className="rounded-xl border border-dark-border bg-dark-bg px-3 py-2 text-sm text-slate-200 outline-none"
        />
        <button
          type="button"
          onClick={props.onApplyCustom}
          className="rounded-xl border border-dark-border bg-dark-bg px-4 py-2 text-sm text-slate-200 hover:text-slate-100"
        >
          应用自定义范围
        </button>
      </div>
    </div>
  );
}
