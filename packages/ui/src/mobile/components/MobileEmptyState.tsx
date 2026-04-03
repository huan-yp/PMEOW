export function MobileEmptyState({
  icon,
  title,
  description,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div className="brand-card rounded-[28px] px-5 py-10 text-center">
      {icon ? (
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-accent-cyan shadow-[0_16px_40px_rgba(6,182,212,0.14)]">
          {icon}
        </div>
      ) : null}
      <p className="mt-4 brand-kicker">empty state</p>
      <p className="mt-2 text-base font-medium text-slate-100">{title}</p>
      {description ? <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p> : null}
    </div>
  );
}
