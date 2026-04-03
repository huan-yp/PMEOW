export function MobileSummaryCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
}) {
  return (
    <div className="brand-card relative overflow-hidden rounded-[24px] p-4">
      <div className="pointer-events-none absolute -right-4 top-0 h-16 w-16 rounded-full bg-accent-cyan/8 blur-2xl" />
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">{title}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-50">{value}</p>
      {subtitle ? <p className="mt-2 text-sm text-slate-400">{subtitle}</p> : null}
    </div>
  );
}
