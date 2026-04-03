import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setServerUrl, getServerUrl } from '../session/server-url.js';
import { setPersonToken } from '../session/person-session.js';
import { BrandMarkIcon, TokenIcon } from '../components/MobileIcons.js';

type Mode = 'person' | 'admin';

export function ConnectScreen() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('person');
  const [server, setServer] = useState(() => getServerUrl() ?? '');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handlePersonConnect = async () => {
    if (!server.trim() || !token.trim()) return;
    setLoading(true);
    setError('');

    const base = server.trim().replace(/\/+$/, '');

    try {
      const res = await fetch(`${base}/api/mobile/me/bootstrap`, {
        headers: { 'X-PMEOW-Person-Token': token.trim() },
      });
      if (!res.ok) {
        setError(res.status === 401 || res.status === 403 ? '令牌无效或已被吊销' : `服务器返回 HTTP ${res.status}`);
        return;
      }
      setServerUrl(base);
      setPersonToken(token.trim());
      navigate('/m/me', { replace: true });
    } catch {
      setError('无法连接到服务器，请检查地址和网络');
    } finally {
      setLoading(false);
    }
  };

  const handleAdminConnect = async () => {
    if (!server.trim() || !password.trim()) return;
    setLoading(true);
    setError('');

    const base = server.trim().replace(/\/+$/, '');

    try {
      const res = await fetch(`${base}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password.trim() }),
      });
      if (!res.ok) {
        setError(res.status === 401 ? '密码错误' : `服务器返回 HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      if (!data.token) {
        setError('登录失败');
        return;
      }
      setServerUrl(base);
      localStorage.setItem('auth_token', data.token);
      navigate('/m/admin', { replace: true });
    } catch {
      setError('无法连接到服务器，请检查地址和网络');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="brand-shell min-h-screen px-4 py-6 text-slate-200">
      <div className="brand-shell-grid" />

      <div className="mx-auto flex min-h-screen max-w-md items-center">
        <div className="w-full space-y-4">
          <section className="brand-card-strong relative overflow-hidden rounded-[30px] p-6">
            <div className="pointer-events-none absolute -right-6 top-0 h-24 w-24 rounded-full bg-accent-cyan/10 blur-3xl" />
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-accent-cyan shadow-[0_18px_44px_rgba(6,182,212,0.16)]">
              <BrandMarkIcon className="h-7 w-7" />
            </div>
            <p className="mt-5 brand-kicker">mobile access</p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-50">连接 PMEOW</h1>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              使用服务器地址与令牌或管理口令连接，获得和 Web 控制台一致的监测与调度体验。
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="brand-chip">个人模式</span>
              <span className="brand-chip">管理员模式</span>
              <span className="brand-chip">统一视觉层</span>
            </div>
          </section>

          <section className="brand-card rounded-[30px] p-5">
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => { setMode('person'); setError(''); }}
                className={`rounded-[22px] border px-4 py-3 text-left transition-colors ${
                  mode === 'person'
                    ? 'border-accent-cyan/35 bg-accent-cyan/10 text-slate-100'
                    : 'border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-slate-200'
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <TokenIcon className="h-4 w-4" />
                  个人模式
                </span>
                <span className="mt-1 block text-xs leading-5 opacity-80">适合成员查看任务、节点和通知。</span>
              </button>

              <button
                type="button"
                onClick={() => { setMode('admin'); setError(''); }}
                className={`rounded-[22px] border px-4 py-3 text-left transition-colors ${
                  mode === 'admin'
                    ? 'border-accent-cyan/35 bg-accent-cyan/10 text-slate-100'
                    : 'border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-slate-200'
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <BrandMarkIcon className="h-4 w-4" />
                  管理员模式
                </span>
                <span className="mt-1 block text-xs leading-5 opacity-80">进入完整控制台，查看全量节点和调度状态。</span>
              </button>
            </div>

            <div className="mt-5 space-y-3">
              <div>
                <label className="mb-2 block text-sm text-slate-400">服务器地址</label>
                <input
                  type="url"
                  value={server}
                  onChange={e => setServer(e.target.value)}
                  placeholder="https://your-server:17200"
                  className="w-full rounded-2xl border border-dark-border bg-dark-bg/80 px-4 py-3 text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-600 focus:border-accent-blue"
                />
              </div>

              {mode === 'person' ? (
                <div>
                  <label className="mb-2 block text-sm text-slate-400">个人访问令牌</label>
                  <input
                    type="text"
                    value={token}
                    onChange={e => setToken(e.target.value)}
                    placeholder="pmt_..."
                    className="w-full rounded-2xl border border-dark-border bg-dark-bg/80 px-4 py-3 text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-600 focus:border-accent-blue"
                  />
                </div>
              ) : (
                <div>
                  <label className="mb-2 block text-sm text-slate-400">管理员密码</label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="管理员密码"
                    className="w-full rounded-2xl border border-dark-border bg-dark-bg/80 px-4 py-3 text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-600 focus:border-accent-blue"
                  />
                </div>
              )}

              <button
                type="button"
                onClick={() => void (mode === 'person' ? handlePersonConnect() : handleAdminConnect())}
                disabled={loading || !server.trim() || (mode === 'person' ? !token.trim() : !password.trim())}
                className="w-full rounded-2xl bg-accent-blue px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-blue/80 disabled:opacity-50"
              >
                {loading ? '连接中...' : mode === 'person' ? '连接个人端' : '连接管理端'}
              </button>

              <p className="text-xs leading-5 text-slate-500">建议使用 HTTPS 地址，确保移动端与 Web 端都通过同一服务器入口访问。</p>
            </div>

            {error ? (
              <p className="mt-4 rounded-2xl border border-accent-red/20 bg-accent-red/10 px-3 py-2 text-center text-sm text-accent-red">
                {error}
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
