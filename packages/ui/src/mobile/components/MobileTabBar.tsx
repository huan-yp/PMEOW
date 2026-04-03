import { NavLink } from 'react-router-dom';

export interface MobileTabItem {
  to: string;
  label: string;
  icon: React.ReactNode;
}

export function MobileTabBar({ items }: { items: MobileTabItem[] }) {
  return (
    <nav aria-label="移动导航" className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 mobile-tabbar-safe">
      <div className="pointer-events-auto mx-auto flex max-w-md items-center gap-2 rounded-[28px] border border-white/10 bg-slate-950/78 p-2 shadow-[0_24px_60px_rgba(2,6,23,0.48)] backdrop-blur-2xl">
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} end className="group flex flex-1">
            {({ isActive }) => (
              <span
                className={`flex w-full flex-col items-center justify-center gap-1 rounded-[20px] px-2 py-2 text-[11px] font-medium transition-all ${
                  isActive
                    ? 'bg-white/[0.06] text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                    : 'text-slate-500 group-hover:text-slate-300'
                }`}
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-2xl transition-all ${
                    isActive
                      ? 'bg-accent-cyan/12 text-accent-cyan shadow-[0_12px_30px_rgba(6,182,212,0.18)]'
                      : 'bg-white/[0.03] text-slate-500 group-hover:bg-white/[0.06] group-hover:text-slate-300'
                  }`}
                >
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </span>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
