import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
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
import { TaskAuditDetail } from './pages/TaskAuditDetail.js';
import { Security } from './pages/Security.js';
import { Login } from './pages/Login.js';
import { PeopleOverview } from './pages/PeopleOverview.js';
import { PeopleManage } from './pages/PeopleManage.js';
import { PersonDetail } from './pages/PersonDetail.js';
import { MobileAdminLayout } from './mobile/layouts/MobileAdminLayout.js';
import { AdminHome } from './mobile/screens/admin/Home.js';
import { AdminTasks } from './mobile/screens/admin/Tasks.js';
import { AdminNodes } from './mobile/screens/admin/Nodes.js';
import { AdminNotifications } from './mobile/screens/admin/Notifications.js';
import { MobilePersonLayout } from './mobile/layouts/MobilePersonLayout.js';
import { PersonHome } from './mobile/screens/person/Home.js';
import { PersonTasks } from './mobile/screens/person/Tasks.js';
import { PersonNodes } from './mobile/screens/person/Nodes.js';
import { PersonNotifications } from './mobile/screens/person/Notifications.js';
import { PersonSettings } from './mobile/screens/person/Settings.js';
import { ConnectScreen } from './mobile/screens/ConnectScreen.js';
import { getServerUrl } from './mobile/session/server-url.js';
import { AUTHOR_GITHUB_URL, AUTHOR_NAME, COPYRIGHT_YEAR } from './utils/branding.js';

function SidebarNav({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const links = [
    { to: '/', icon: DashboardIcon, label: '控制台' },
    { to: '/servers', icon: ServerIcon, label: '节点' },
    { to: '/people', icon: PeopleIcon, label: '人员' },
    { to: '/hooks', icon: HookIcon, label: '钩子规则' },
    { to: '/alerts', icon: AlertIcon, label: '告警' },
    { to: '/tasks', icon: TaskIcon, label: '任务调度' },
    { to: '/security', icon: ShieldIcon, label: '安全审计' },
    { to: '/settings', icon: SettingsIcon, label: '设置' },
  ];

  return (
    <aside className={`fixed left-0 top-0 z-30 flex h-screen flex-col border-r border-dark-border bg-dark-card/85 backdrop-blur-xl transition-all duration-200 ${collapsed ? 'w-16' : 'w-64'}`}>
      <div className="shrink-0 border-b border-dark-border px-3 py-4">
        <div className={`rounded-2xl border border-white/10 bg-white/[0.03] ${collapsed ? 'flex items-center justify-center p-2.5' : 'flex items-start gap-3 p-3'}`}>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent-cyan/20 to-accent-blue/25 text-accent-blue">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M5 6.75A1.75 1.75 0 016.75 5h10.5A1.75 1.75 0 0119 6.75v2.5A1.75 1.75 0 0117.25 11H6.75A1.75 1.75 0 015 9.25v-2.5zm0 8A1.75 1.75 0 016.75 13h4.5A1.75 1.75 0 0113 14.75v2.5A1.75 1.75 0 0111.25 19h-4.5A1.75 1.75 0 015 17.25v-2.5zm10 0A1.75 1.75 0 0116.75 13h.5A1.75 1.75 0 0119 14.75v2.5A1.75 1.75 0 0117.25 19h-.5A1.75 1.75 0 0115 17.25v-2.5z" />
            </svg>
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="brand-kicker">PMEOW Console</p>
              <p className="mt-1 text-sm font-semibold text-slate-100">PMEOW</p>
              <p className="mt-1 text-xs text-slate-500">节点 / 任务 / GPU 观测</p>
            </div>
          )}
        </div>
      </div>

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

      {!collapsed && (
        <div className="border-t border-dark-border px-3 py-3">
          <a
            href={AUTHOR_GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-slate-400 transition-colors hover:text-slate-200"
          >
            Powered By {AUTHOR_NAME}
          </a>
          <p className="mt-1 text-[11px] text-slate-600">Copyright © {COPYRIGHT_YEAR} {AUTHOR_NAME}</p>
        </div>
      )}

      <button
        onClick={onToggle}
        className="h-12 flex items-center justify-center border-t border-dark-border text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-300"
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="brand-shell min-h-screen bg-dark-bg text-slate-200">
      <SidebarNav collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((value) => !value)} />
      <main className={`min-h-screen transition-all duration-200 ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/server/:id" element={<ServerDetail />} />
          <Route path="/servers" element={<ServersManage />} />
          <Route path="/hooks" element={<HooksManage />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/tasks" element={<TaskQueue />} />
          <Route path="/tasks/:serverId/:taskId" element={<TaskAuditDetail />} />
          <Route path="/security" element={<Security />} />
          <Route path="/people" element={<PeopleOverview />} />
          <Route path="/people/new" element={<PeopleManage />} />
          <Route path="/people/manage" element={<Navigate to="/people/new" replace />} />
          <Route path="/people/:id" element={<PersonDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/m/admin" element={<MobileAdminLayout />}>
            <Route index element={<AdminHome />} />
            <Route path="tasks" element={<AdminTasks />} />
            <Route path="nodes" element={<AdminNodes />} />
            <Route path="notifications" element={<AdminNotifications />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <ToastContainer />
    </div>
  );
}

function AuthBootstrap() {
  return (
    <div className="brand-shell flex min-h-screen items-center justify-center p-4">
      <div role="status" aria-live="polite" className="brand-card rounded-3xl px-6 py-5 text-center">
        <p className="brand-kicker">AUTH</p>
        <p className="mt-2 text-sm text-slate-300">正在恢复登录状态...</p>
      </div>
    </div>
  );
}

function AuthGate() {
  const transport = useTransport();
  const { authenticated, setAuthenticated } = useStore();
  const [authReady, setAuthReady] = useState(Boolean(transport.isElectron));

  useEffect(() => {
    let cancelled = false;

    if (transport.isElectron) {
      setAuthenticated(true);
      setAuthReady(true);
      return;
    }

    setAuthReady(false);

    void transport.checkAuth()
      .then(({ authenticated: nextAuthenticated }) => {
        if (cancelled) {
          return;
        }

        setAuthenticated(nextAuthenticated);
        setAuthReady(true);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setAuthenticated(false);
        setAuthReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [transport, setAuthenticated]);

  if (!authReady && !transport.isElectron) {
    return <AuthBootstrap />;
  }

  if (!authenticated && !transport.isElectron) {
    return <Login onSuccess={() => setAuthenticated(true)} />;
  }

  return <AppContent />;
}

export default function App({ adapter }: { adapter?: TransportAdapter }) {
  return (
    <TransportProvider adapter={adapter}>
      <BrowserRouter>
        <CapacitorGate />
      </BrowserRouter>
    </TransportProvider>
  );
}

/** In Capacitor native environment, redirect to /connect if no server URL is configured. */
function CapacitorGate() {
  const location = useLocation();
  const isNative = typeof (window as any).Capacitor?.isNativePlatform === 'function'
    && (window as any).Capacitor.isNativePlatform();

  if (isNative && !getServerUrl() && location.pathname !== '/connect') {
    return <Navigate to="/connect" replace />;
  }

  return <AppRouter />;
}

function AppRouter() {
  const location = useLocation();

  // Capacitor native: show connect screen if no server configured
  if (location.pathname === '/connect') {
    return (
      <Routes>
        <Route path="/connect" element={<ConnectScreen />} />
      </Routes>
    );
  }

  // Person mobile routes bypass admin auth
  if (location.pathname.startsWith('/m/me')) {
    return (
      <Routes>
        <Route path="/m/me" element={<MobilePersonLayout />}>
          <Route index element={<PersonHome />} />
          <Route path="tasks" element={<PersonTasks />} />
          <Route path="nodes" element={<PersonNodes />} />
          <Route path="notifications" element={<PersonNotifications />} />
          <Route path="settings" element={<PersonSettings />} />
        </Route>
      </Routes>
    );
  }

  return <AuthGate />;
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

function PeopleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  );
}
