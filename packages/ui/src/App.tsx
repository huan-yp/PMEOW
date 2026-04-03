import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { TransportProvider, useTransport } from './transport/TransportProvider.js';
import type { TransportAdapter } from './transport/types.js';
import { useStore } from './store/useStore.js';
import { useMetricsSubscription, useLoadInitialData } from './hooks/useMetrics.js';
import { useOperatorBootstrap } from './hooks/useOperatorData.js';
import { ToastContainer } from './components/common/Toast.js';
import { Overview } from './pages/Overview.js';
import { ServerDetail } from './pages/ServerDetail.js';
import { ServersManage } from './pages/ServersManage.js';
import { HooksManage } from './pages/HooksManage.js';
import { Settings } from './pages/Settings.js';
import { Alerts } from './pages/Alerts.js';
import { TaskQueue } from './pages/TaskQueue.js';
import { Security } from './pages/Security.js';
import { Login } from './pages/Login.js';

function SidebarNav() {
  const [collapsed, setCollapsed] = useState(false);

  const links = [
    { to: '/', icon: DashboardIcon, label: '概览' },
    { to: '/servers', icon: ServerIcon, label: '服务器' },
    { to: '/hooks', icon: HookIcon, label: '钩子规则' },
    { to: '/alerts', icon: AlertIcon, label: '告警' },
    { to: '/tasks', icon: TaskIcon, label: 'Tasks' },
    { to: '/security', icon: ShieldIcon, label: 'Security' },
    { to: '/settings', icon: SettingsIcon, label: '设置' },
  ];

  return (
    <aside className={`fixed left-0 top-0 h-screen bg-dark-card border-r border-dark-border flex flex-col transition-all duration-200 z-30 ${collapsed ? 'w-16' : 'w-52'}`}>
      {/* Logo */}
      <div className="h-14 flex items-center gap-2 px-4 border-b border-dark-border shrink-0">
        <div className="w-8 h-8 rounded bg-accent-blue/20 flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-accent-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        {!collapsed && <span className="font-bold text-slate-200 text-sm">Monitor</span>}
      </div>

      {/* Nav Links */}
      <nav className="flex-1 py-3 space-y-1 px-2">
        {links.map(l => (
          <NavLink key={l.to} to={l.to} end={l.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${isActive ? 'bg-accent-blue/10 text-accent-blue' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`
            }>
            <l.icon className="w-5 h-5 shrink-0" />
            {!collapsed && <span>{l.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Collapse button */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="h-12 flex items-center justify-center text-slate-500 hover:text-slate-300 border-t border-dark-border"
      >
        <svg className={`w-4 h-4 transition-transform ${collapsed ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
        </svg>
      </button>
    </aside>
  );
}

function AppContent() {
  useMetricsSubscription();
  useLoadInitialData();
  useOperatorBootstrap();

  return (
    <div className="min-h-screen bg-dark-bg text-slate-200">
      <SidebarNav />
      <main className="ml-52 min-h-screen">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/server/:id" element={<ServerDetail />} />
          <Route path="/servers" element={<ServersManage />} />
          <Route path="/hooks" element={<HooksManage />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/tasks" element={<TaskQueue />} />
          <Route path="/security" element={<Security />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <ToastContainer />
    </div>
  );
}

function AuthGate() {
  const transport = useTransport();
  const { authenticated, setAuthenticated } = useStore();

  useEffect(() => {
    if (transport.isElectron) {
      setAuthenticated(true);
    }
  }, [transport.isElectron, setAuthenticated]);

  if (!authenticated && !transport.isElectron) {
    return <Login onSuccess={() => setAuthenticated(true)} />;
  }

  return <AppContent />;
}

export default function App({ adapter }: { adapter?: TransportAdapter }) {
  return (
    <TransportProvider adapter={adapter}>
      <BrowserRouter>
        <AuthGate />
      </BrowserRouter>
    </TransportProvider>
  );
}

/* ----- Icon components ----- */
function DashboardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10-2a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z" />
    </svg>
  );
}

function ServerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
    </svg>
  );
}

function HookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  );
}

function TaskIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M12 3l7 4v5c0 5-3.5 7.5-7 9-3.5-1.5-7-4-7-9V7l7-4zm-2.5 8.5l1.5 1.5 3.5-3.5" />
    </svg>
  );
}
