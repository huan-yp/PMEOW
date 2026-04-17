import { useState } from 'react';
import { useTransport } from '../transport/TransportProvider.js';
import { useStore } from '../store/useStore.js';
import { AUTHOR_NAME, AUTHOR_GITHUB_URL, PROJECT_REPO_URL } from '../utils/branding.js';

interface Props {
  onLogin: () => void;
}

export default function Login({ onLogin }: Props) {
  const transport = useTransport();
  const addToast = useStore((s) => s.addToast);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    try {
      await transport.login(password);
      onLogin();
    } catch (err) {
      addToast('登录失败', err instanceof Error ? err.message : '请检查密码', 'error');
    }
    setLoading(false);
  };

  return (
    <div className="brand-shell flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-100">PMEOW</h1>
          <p className="mt-1 text-sm text-slate-500">GPU 集群管理系统</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入访问口令"
            className="w-full rounded-xl border border-dark-border bg-dark-card px-4 py-3 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-accent-blue"
            autoFocus
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-accent-blue py-3 text-sm font-medium text-white hover:bg-accent-blue/80 disabled:opacity-50"
          >
            {loading ? '验证中...' : '登录'}
          </button>
        </form>

        <div className="text-center space-y-1">
          <a href={PROJECT_REPO_URL} target="_blank" rel="noreferrer" className="block text-xs text-slate-500 hover:text-slate-400">
            GitHub Repo · 本项目开源
          </a>
          <a href={AUTHOR_GITHUB_URL} target="_blank" rel="noreferrer" className="block text-xs text-slate-600 hover:text-slate-400">
            Powered By {AUTHOR_NAME}
          </a>
        </div>
      </div>
    </div>
  );
}
