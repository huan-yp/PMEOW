import { NavLink } from 'react-router-dom';

export interface MobileTabItem {
  to: string;
  label: string;
  icon: React.ReactNode;
}

export function MobileTabBar({ items }: { items: MobileTabItem[] }) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 flex h-14 items-center border-t border-dark-border bg-dark-card/95 backdrop-blur-xl safe-area-bottom">
      {items.map(item => (
        <NavLink
          key={item.to}
          to={item.to}
          end
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center justify-center gap-0.5 text-xs transition-colors ${
              isActive ? 'text-accent-blue' : 'text-slate-500'
            }`
          }
        >
          <span className="text-lg">{item.icon}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
