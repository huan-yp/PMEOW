import { useState } from 'react';
import { useTransport } from '../transport/TransportProvider.js';

interface LoginProps {
  onSuccess: () => void;
}

export function Login({ onSuccess }: LoginProps) {
  const transport = useTransport();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await transport.login(password);
      if (result.success) {
        onSuccess();
      } else {
        setError(result.error || '密码错误');
      }
    } catch {
      setError('登录失败，请检查网络连接');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-dark-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="w-10 h-10 rounded-lg bg-accent-blue/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-accent-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
          </div>
          <h1 className="text-2xl font-bold text-slate-100">Monitor</h1>
          <p className="text-sm text-slate-500 mt-1">服务器硬件监控平台</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-dark-card border border-dark-border rounded-lg p-6">
          <div className="mb-4">
            <label className="block text-sm text-slate-400 mb-1">密码</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="请输入登录密码"
              autoFocus
              className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2.5 text-sm text-slate-200 focus:border-accent-blue focus:outline-none placeholder-slate-600"
            />
          </div>
          {error && (
            <p className="text-xs text-accent-red mb-3">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-2.5 bg-accent-blue text-white text-sm font-medium rounded-lg hover:bg-accent-blue/80 transition-colors disabled:opacity-50"
          >
            {loading ? '登录中...' : '登 录'}
          </button>
        </form>
      </div>
    </div>
  );
}
