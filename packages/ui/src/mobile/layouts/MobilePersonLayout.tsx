import { useState, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { MobileAppShell } from '../components/MobileAppShell.js';
import { NodesIcon, NotificationsIcon, OverviewIcon, TasksIcon, TokenIcon } from '../components/MobileIcons.js';
import { getPersonToken, setPersonToken } from '../session/person-session.js';
import { getServerUrl } from '../session/server-url.js';
import { getPersonBootstrap } from '../api/person.js';

export function MobilePersonLayout() {
  const [valid, setValid] = useState<boolean | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const token = getPersonToken();
    if (!token) {
      // If running in Capacitor with server URL but no token, redirect to connect screen
      if (getServerUrl()) {
        navigate('/connect', { replace: true });
        return;
      }
      setValid(false);
      return;
    }
    void getPersonBootstrap()
      .then(() => setValid(true))
      .catch(() => {
        setValid(false);
      });
  }, []);

  const handleSubmit = () => {
    if (!tokenInput.trim()) return;
    setPersonToken(tokenInput.trim());
    setValid(null);
    void getPersonBootstrap()
      .then(() => setValid(true))
      .catch(() => setValid(false));
  };

  if (valid === null) {
    return (
      <div className="brand-shell flex min-h-screen items-center justify-center px-4 text-slate-200">
        <div className="brand-shell-grid" />
        <div role="status" aria-live="polite" className="brand-card rounded-[28px] px-6 py-5 text-center">
          <p className="brand-kicker">personal access</p>
          <p className="mt-3 text-base font-semibold text-slate-100">正在验证令牌...</p>
          <p className="mt-2 text-sm text-slate-400">正在恢复你的个人移动工作台。</p>
        </div>
      </div>
    );
  }

  if (valid === false) {
    return (
      <div className="brand-shell min-h-screen px-4 py-6 text-slate-200">
        <div className="brand-shell-grid" />
        <div className="mx-auto flex min-h-screen max-w-md items-center">
          <div className="w-full space-y-4">
            <section className="brand-card-strong relative overflow-hidden rounded-[30px] p-6">
              <div className="pointer-events-none absolute -right-6 top-0 h-24 w-24 rounded-full bg-accent-cyan/10 blur-3xl" />
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-accent-cyan shadow-[0_18px_44px_rgba(6,182,212,0.16)]">
                <TokenIcon className="h-7 w-7" />
              </div>
              <p className="mt-5 brand-kicker">personal token</p>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-50">验证个人令牌</h1>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                使用管理员签发的访问令牌进入个人工作台，保持与 Web 端一致的任务、节点和通知体验。
              </p>
            </section>

            <section className="brand-card rounded-[30px] p-5">
              <label className="mb-2 block text-sm text-slate-400">个人访问令牌</label>
              <input
                type="text"
                value={tokenInput}
                onChange={e => setTokenInput(e.target.value)}
                placeholder="pmt_..."
                className="w-full rounded-2xl border border-dark-border bg-dark-bg/80 px-4 py-3 text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-600 focus:border-accent-blue"
              />
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!tokenInput.trim()}
                className="mt-4 w-full rounded-2xl bg-accent-blue px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-blue/80 disabled:opacity-50"
              >
                验证令牌
              </button>
              <p className="mt-3 text-xs leading-5 text-slate-500">如令牌失效，请联系管理员重新生成。</p>
            </section>
          </div>
        </div>
      </div>
    );
  }

  const tabs = [
    { to: '/m/me', label: '首页', icon: <OverviewIcon className="h-4 w-4" /> },
    { to: '/m/me/tasks', label: '任务', icon: <TasksIcon className="h-4 w-4" /> },
    { to: '/m/me/nodes', label: '节点', icon: <NodesIcon className="h-4 w-4" /> },
    { to: '/m/me/notifications', label: '通知', icon: <NotificationsIcon className="h-4 w-4" /> },
  ];

  return (
    <MobileAppShell
      headerKicker="PMEOW personal"
      title="个人工作台"
      description="查看与你的 Web 端一致的个人任务、绑定节点和通知动态。"
      capsuleLabel="PERSON"
      badges={['任务视图', '绑定节点', '个人通知']}
      tabs={tabs}
    >
      <div className="px-1 py-2">
        <Outlet />
      </div>
    </MobileAppShell>
  );
}
