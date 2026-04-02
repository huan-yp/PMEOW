interface Props {
  value: number;
  label: string;
  showPercent?: boolean;
}

export function ProgressBar({ value, label, showPercent = true }: Props) {
  const clamped = Math.max(0, Math.min(100, value));
  const color =
    clamped >= 90 ? 'bg-accent-red' :
    clamped >= 70 ? 'bg-accent-yellow' :
    'bg-accent-green';

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 w-12 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-dark-bg rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${color}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showPercent && (
        <span className={`text-xs font-mono w-10 text-right ${
          clamped >= 90 ? 'text-accent-red' : clamped >= 70 ? 'text-accent-yellow' : 'text-slate-400'
        }`}>
          {clamped.toFixed(0)}%
        </span>
      )}
    </div>
  );
}
