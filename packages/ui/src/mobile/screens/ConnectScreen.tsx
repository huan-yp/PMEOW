import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setServerUrl, getServerUrl } from '../session/server-url.js';
import { setPersonToken } from '../session/person-session.js';

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
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-dark-bg p-6 text-slate-200">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-cyan/20 to-accent-blue/25 text-accent-blue">
        <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
            d="M5 6.75A1.75 1.75 0 016.75 5h10.5A1.75 1.75 0 0119 6.75v2.5A1.75 1.75 0 0117.25 11H6.75A1.75 1.75 0 015 9.25v-2.5zm0 8A1.75 1.75 0 016.75 13h4.5A1.75 1.75 0 0113 14.75v2.5A1.75 1.75 0 0111.25 19h-4.5A1.75 1.75 0 015 17.25v-2.5zm10 0A1.75 1.75 0 0116.75 13h.5A1.75 1.75 0 0119 14.75v2.5A1.75 1.75 0 0117.25 19h-.5A1.75 1.75 0 0115 17.25v-2.5z" />
        </svg>
      </div>
      <p className="text-lg font-semibold">PMEOW</p>
      <p className="text-sm text-slate-400">连接到你的 PMEOW 服务器</p>

      {/* Mode toggle */}
      <div className="flex w-full max-w-sm rounded-lg border border-dark-border bg-dark-card text-sm">
        <button
          onClick={() => { setMode('person'); setError(''); }}
          className={`flex-1 rounded-lg py-2 transition-colors ${mode === 'person' ? 'bg-accent-blue text-white' : 'text-slate-400'}`}
        >
          个人模式
        </button>
        <button
          onClick={() => { setMode('admin'); setError(''); }}
          className={`flex-1 rounded-lg py-2 transition-colors ${mode === 'admin' ? 'bg-accent-blue text-white' : 'text-slate-400'}`}
        >
          管理员模式
        </button>
      </div>

      {/* Server URL */}
      <input
        type="url"
        value={server}
        onChange={e => setServer(e.target.value)}
        placeholder="https://your-server:17200"
        className="w-full max-w-sm rounded-lg border border-dark-border bg-dark-card px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-500"
      />

      {mode === 'person' ? (
        <>
          <input
            type="text"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="pmt_..."
            className="w-full max-w-sm rounded-lg border border-dark-border bg-dark-card px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-500"
          />
          <button
            onClick={handlePersonConnect}
            disabled={loading || !server.trim() || !token.trim()}
            className="w-full max-w-sm rounded-lg bg-accent-blue px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? '连接中...' : '连接'}
          </button>
        </>
      ) : (
        <>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="管理员密码"
            className="w-full max-w-sm rounded-lg border border-dark-border bg-dark-card px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-500"
          />
          <button
            onClick={handleAdminConnect}
            disabled={loading || !server.trim() || !password.trim()}
            className="w-full max-w-sm rounded-lg bg-accent-blue px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? '连接中...' : '连接'}
          </button>
        </>
      )}

      {error && (
        <p className="w-full max-w-sm rounded-lg border border-red-800/50 bg-red-900/20 px-3 py-2 text-center text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
