import { BrandMarkIcon } from './MobileIcons.js';
import { MobileTabBar, type MobileTabItem } from './MobileTabBar.js';

interface MobileAppShellProps {
  headerKicker: string;
  title: string;
  description: string;
  capsuleLabel: string;
  badges?: string[];
  tabs: MobileTabItem[];
  children: React.ReactNode;
}

export function MobileAppShell({
  headerKicker,
  title,
  description,
  capsuleLabel,
  badges = [],
  tabs,
  children,
}: MobileAppShellProps) {
  return (
    <div className="brand-shell min-h-screen text-slate-200">
      <div className="brand-shell-grid" />

      <div className="relative mx-auto flex min-h-screen max-w-md flex-col px-4 pt-4 mobile-shell-safe">
        <header className="sticky top-0 z-30 pb-4 pt-1">
          <div className="brand-card-strong relative overflow-hidden rounded-[28px] px-5 py-5">
            <div className="pointer-events-none absolute -right-6 top-0 h-24 w-24 rounded-full bg-accent-cyan/10 blur-3xl" />

            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-accent-cyan shadow-[0_18px_44px_rgba(6,182,212,0.16)]">
                <BrandMarkIcon className="h-7 w-7" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="brand-kicker">{headerKicker}</p>
                    <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-50">{title}</h1>
                  </div>

                  <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                    {capsuleLabel}
                  </span>
                </div>

                <p className="mt-2 text-sm leading-6 text-slate-300">{description}</p>

                {badges.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {badges.map((badge) => (
                      <span key={badge} className="brand-chip px-3 py-1 text-[11px] text-slate-300">
                        {badge}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 pb-6">{children}</main>
      </div>

      <MobileTabBar items={tabs} />
    </div>
  );
}