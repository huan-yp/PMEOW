export function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-mono font-semibold text-slate-100">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
