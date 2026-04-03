import { Outlet } from 'react-router-dom';
import { MobileTabBar } from '../components/MobileTabBar.js';

export function MobileAdminLayout() {
  const tabs = [
    { to: '/m/admin', label: '首页', icon: '📊' },
    { to: '/m/admin/tasks', label: '任务', icon: '📋' },
    { to: '/m/admin/nodes', label: '节点', icon: '🖥️' },
    { to: '/m/admin/notifications', label: '通知', icon: '🔔' },
  ];

  return (
    <div className="min-h-screen bg-dark-bg text-slate-200 pb-16">
      <header className="sticky top-0 z-30 border-b border-dark-border bg-dark-card/95 px-4 py-3 backdrop-blur-xl">
        <p className="text-xs text-slate-500">PMEOW 管理端</p>
      </header>
      <div className="px-4 py-4">
        <Outlet />
      </div>
      <MobileTabBar items={tabs} />
    </div>
  );
}
