import { useState, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { MobileTabBar } from '../components/MobileTabBar.js';
import { getPersonToken } from '../session/person-session.js';
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
    localStorage.setItem('pmeow_person_token', tokenInput.trim());
    setValid(null);
    void getPersonBootstrap()
      .then(() => setValid(true))
      .catch(() => setValid(false));
  };

  if (valid === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-dark-bg text-slate-300">
        <p className="text-sm">正在验证令牌...</p>
      </div>
    );
  }

  if (valid === false) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-dark-bg p-6 text-slate-200">
        <p className="text-lg font-semibold">PMEOW 个人移动端</p>
        <p className="text-sm text-slate-400">请输入管理员提供的个人访问令牌</p>
        <input
          type="text"
          value={tokenInput}
          onChange={e => setTokenInput(e.target.value)}
          placeholder="pmt_..."
          className="w-full max-w-sm rounded-lg border border-dark-border bg-dark-card px-3 py-2 text-sm text-slate-200"
        />
        <button
          onClick={handleSubmit}
          className="rounded-lg bg-accent-blue px-4 py-2 text-sm text-white"
        >
          验证令牌
        </button>
      </div>
    );
  }

  const tabs = [
    { to: '/m/me', label: '首页', icon: '🏠' },
    { to: '/m/me/tasks', label: '任务', icon: '📋' },
    { to: '/m/me/nodes', label: '节点', icon: '🖥️' },
    { to: '/m/me/notifications', label: '通知', icon: '🔔' },
  ];

  return (
    <div className="min-h-screen bg-dark-bg text-slate-200 pb-16">
      <header className="sticky top-0 z-30 border-b border-dark-border bg-dark-card/95 px-4 py-3 backdrop-blur-xl">
        <p className="text-xs text-slate-500">PMEOW 个人端</p>
      </header>
      <div className="px-4 py-4">
        <Outlet />
      </div>
      <MobileTabBar items={tabs} />
    </div>
  );
}
