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
    <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
      <p className="text-xs text-slate-500">{title}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-100">{value}</p>
      {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
    </div>
  );
}
