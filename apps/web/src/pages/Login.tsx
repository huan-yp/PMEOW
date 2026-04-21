import { useState } from 'react';
import { useTransport } from '../transport/TransportProvider.js';
import { useStore } from '../store/useStore.js';
import type { LoginResult } from '../transport/types.js';
import { AUTHOR_NAME, AUTHOR_GITHUB_URL, COPYRIGHT_YEAR, PROJECT_REPO_URL } from '../utils/branding.js';

interface Props {
  onLogin: (session: LoginResult) => void;
}

export default function Login({ onLogin }: Props) {
  const transport = useTransport();
  const addToast = useStore((s) => s.addToast);
  const [mode, setMode] = useState<'password' | 'token'>('password');
  const [password, setPassword] = useState('');
  const [personToken, setPersonToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'password' && !password.trim()) return;
    if (mode === 'token' && !personToken.trim()) return;
    setError('');
    setLoading(true);
    try {
      const session = await transport.login(
        mode === 'password'
          ? { password: password.trim() }
          : { token: personToken.trim() },
      );
      onLogin(session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '请检查登录信息';
      setError(msg);
      addToast('登录失败', msg, 'error');
    }
    setLoading(false);
  };

  const capabilities = [
    {
      title: '节点接入视图',
      body: '统一查看 GPU 节点的在线状态和资源指标。',
    },
    {
      title: '任务调度控制',
      body: '聚合排队、运行和近期任务，支持基础调度操作。',
    },
    {
      title: 'GPU 归属审计',
      body: '持续跟踪显存占用分布与异常事件，便于排查归属问题。',
    },
  ] as const;

  return (
    <div className="brand-shell min-h-screen p-3 sm:p-4 md:p-8">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center">
        <div className="grid w-full gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1.2fr)_420px]">
          <section className="brand-card-strong relative overflow-hidden rounded-3xl p-5 sm:p-6 md:p-10">
            <div className="pointer-events-none absolute right-8 top-8 h-28 w-28 rounded-full bg-accent-cyan/10 blur-3xl" />
            <p className="brand-kicker">PMEOW control panel</p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl md:text-5xl">PALM 负载编排管理引擎</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
              面向高校实验室的轻量 GPU 集群统一调度管理平台。
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <span className="brand-chip">节点状态监控</span>
              <span className="brand-chip">任务队列控制</span>
              <span className="brand-chip">GPU 占用审计</span>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {capabilities.map((item) => (
                <div key={item.title} className="rounded-2xl border border-white/10 bg-slate-950/25 p-4 backdrop-blur-sm">
                  <h2 className="text-sm font-semibold text-slate-100">{item.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{item.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="brand-card rounded-3xl p-5 sm:p-6 md:p-7">
            <div className="mb-6 flex flex-col items-center">
              <div className="mb-4 h-48 w-48 overflow-hidden rounded-full border-2 border-accent-cyan/30 shadow-lg shadow-accent-cyan/10 sm:h-56 sm:w-56 md:h-64 md:w-64 lg:h-72 lg:w-72">
                <img src="/icon.jpg" alt="PMEOW" className="h-full w-full object-cover" />
              </div>
              <p className="brand-kicker">ACCESS</p>
              <h2 className="mt-3 text-2xl font-semibold text-slate-100">进入 PMEOW 控制台</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                输入访问口令，继续查看节点状态、任务调度与 GPU 观测数据。
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-dark-bg/50 p-1">
                <button
                  type="button"
                  onClick={() => setMode('password')}
                  className={`rounded-lg px-3 py-2 text-sm transition-colors ${mode === 'password' ? 'bg-accent-blue text-white' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  管理员密码
                </button>
                <button
                  type="button"
                  onClick={() => setMode('token')}
                  className={`rounded-lg px-3 py-2 text-sm transition-colors ${mode === 'token' ? 'bg-accent-blue text-white' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  用户令牌
                </button>
              </div>

              <div>
                <label className="mb-1 block text-sm text-slate-400">{mode === 'password' ? '访问口令' : '访问令牌'}</label>
                {mode === 'password' ? (
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="请输入访问口令"
                    autoFocus
                    className="w-full rounded-xl border border-dark-border bg-dark-bg/80 px-3 py-3 text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-600 focus:border-accent-blue"
                  />
                ) : (
                  <textarea
                    value={personToken}
                    onChange={e => setPersonToken(e.target.value)}
                    placeholder="请输入以 pt_ 开头的访问令牌"
                    autoFocus
                    rows={4}
                    className="w-full rounded-xl border border-dark-border bg-dark-bg/80 px-3 py-3 text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-600 focus:border-accent-blue"
                  />
                )}
              </div>

              {error && (
                <p className="rounded-xl border border-accent-red/20 bg-accent-red/10 px-3 py-2 text-sm text-accent-red">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || (mode === 'password' ? !password.trim() : !personToken.trim())}
                className="w-full rounded-xl bg-accent-blue px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-blue/80 disabled:opacity-50"
              >
                {loading ? '登录中...' : mode === 'password' ? '进入控制台' : '进入个人工作台'}
              </button>

              <p className="text-xs leading-5 text-slate-500 max-w-full break-words [overflow-wrap:anywhere]">
                {mode === 'password'
                  ? '登录后可直接进入 PMEOW 总览页，查看节点在线情况、任务队列镜像和 GPU 归属审计结果。'
                  : '使用个人访问令牌后，只会进入自己的机器、任务与资料视图。'}
              </p>
            </form>

            <div className="mt-6 border-t border-white/10 pt-4 text-center">
              <a
                href={PROJECT_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center rounded-full border border-accent-cyan/20 bg-accent-cyan/5 px-4 py-2 text-sm font-medium text-accent-cyan transition-colors hover:border-accent-cyan/40 hover:text-slate-100 sm:inline-flex sm:w-auto"
              >
                GitHub Repo · 本项目开源
              </a>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs text-slate-500">
                <a
                  href={AUTHOR_GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-slate-300"
                >
                  Powered By {AUTHOR_NAME}
                </a>
                <span className="hidden h-1 w-1 rounded-full bg-slate-700 sm:block" />
                <span>Copyright © {COPYRIGHT_YEAR} {AUTHOR_NAME}</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
