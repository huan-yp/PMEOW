export function IdentityPill({ label, value, accent }: { label: string; value: string; accent: 'cyan' | 'green' | 'amber' }) {
  const accentClass = accent === 'green'
    ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100'
    : accent === 'amber'
      ? 'border-amber-400/20 bg-amber-500/10 text-amber-100'
      : 'border-cyan-400/20 bg-cyan-500/10 text-cyan-100';

  return (
    <div className={`rounded-2xl border px-4 py-3 ${accentClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">{label}</p>
      <p className="mt-1 text-base font-medium tracking-tight">{value}</p>
    </div>
  );
}
