import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTransport } from '../transport/TransportProvider.js';
import type { PersonRecord, PersonTimelinePoint, MirroredAgentTaskRecord, PersonBindingRecord } from '@monitor/core';
import { formatVramGB } from '../utils/vram.js';

async function adminFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> ?? {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await window.fetch(url, { ...options, headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function PersonDetail() {
  const { id } = useParams<{ id: string }>();
  const transport = useTransport();
  const [person, setPerson] = useState<PersonRecord | null>(null);
  const [timeline, setTimeline] = useState<PersonTimelinePoint[]>([]);
  const [tasks, setTasks] = useState<MirroredAgentTaskRecord[]>([]);
  const [bindings, setBindings] = useState<PersonBindingRecord[]>([]);
  const [tokenStatus, setTokenStatus] = useState<{ hasToken: boolean; createdAt?: number; lastUsedAt?: number | null } | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    void transport.getPersons().then(all => setPerson(all.find(p => p.id === id) ?? null)).catch(() => setPerson(null));
    void transport.getPersonTimeline(id).then(setTimeline).catch(() => setTimeline([]));
    void transport.getPersonTasks(id).then(setTasks).catch(() => setTasks([]));
    void transport.getPersonBindings(id).then(setBindings).catch(() => setBindings([]));
  }, [id, transport]);

  const refreshTokenStatus = useCallback(() => {
    if (!id) return;
    void adminFetch<{ hasToken: boolean; createdAt?: number; lastUsedAt?: number | null }>(
      `/api/persons/${encodeURIComponent(id)}/mobile-token/status`,
    ).then(setTokenStatus).catch(() => setTokenStatus({ hasToken: false }));
  }, [id]);

  useEffect(() => { refreshTokenStatus(); }, [refreshTokenStatus]);

  const handleCreateToken = async () => {
    if (!id) return;
    setTokenLoading(true);
    setNewToken(null);
    try {
      const res = await adminFetch<{ plainToken: string }>(`/api/persons/${encodeURIComponent(id)}/mobile-token`, { method: 'POST' });
      setNewToken(res.plainToken);
      refreshTokenStatus();
    } finally {
      setTokenLoading(false);
    }
  };

  const handleRotateToken = async () => {
    if (!id) return;
    setTokenLoading(true);
    setNewToken(null);
    try {
      const res = await adminFetch<{ plainToken: string }>(`/api/persons/${encodeURIComponent(id)}/mobile-token/rotate`, { method: 'POST' });
      setNewToken(res.plainToken);
      refreshTokenStatus();
    } finally {
      setTokenLoading(false);
    }
  };

  const handleRevokeToken = async () => {
    if (!id) return;
    setTokenLoading(true);
    setNewToken(null);
    try {
      await adminFetch(`/api/persons/${encodeURIComponent(id)}/mobile-token`, { method: 'DELETE' });
      refreshTokenStatus();
    } finally {
      setTokenLoading(false);
    }
  };

  if (!person) return <div className="p-6 text-slate-400">加载中...</div>;

  return (
    <div className="p-6 space-y-6">
      <div>
        <p className="brand-kicker">PERSON</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-100">{person.displayName}</h1>
        <div className="mt-2 flex gap-4 text-sm text-slate-400">
          {person.email && <span>{person.email}</span>}
          {person.qq && <span>QQ: {person.qq}</span>}
          {person.note && <span>{person.note}</span>}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-dark-border bg-dark-card p-5">
          <h2 className="text-sm text-slate-400 mb-3">绑定</h2>
          {bindings.length === 0 ? (
            <p className="text-sm text-slate-500">无绑定</p>
          ) : (
            <div className="space-y-2">
              {bindings.map(b => (
                <div key={b.id} className="text-sm text-slate-300">
                  {b.serverId} · {b.systemUser}
                  <span className={`ml-2 text-xs ${b.enabled ? 'text-green-400' : 'text-slate-500'}`}>
                    {b.enabled ? '活跃' : '已禁用'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-dark-border bg-dark-card p-5">
          <h2 className="text-sm text-slate-400 mb-3">显存时间线</h2>
          {timeline.length === 0 ? (
            <p className="text-sm text-slate-500">暂无数据</p>
          ) : (
            <div className="space-y-1">
              {timeline.map(t => (
                <div key={t.bucketStart} className="flex justify-between text-sm text-slate-300">
                  <span>{new Date(t.bucketStart).toLocaleTimeString()}</span>
                  <span>{formatVramGB(t.totalVramMB)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-dark-border bg-dark-card p-5">
        <h2 className="text-sm text-slate-400 mb-3">关联任务</h2>
        {tasks.length === 0 ? (
          <p className="text-sm text-slate-500">暂无关联任务</p>
        ) : (
          <div className="space-y-2">
            {tasks.map(t => (
              <div key={t.taskId} className="flex justify-between text-sm text-slate-300">
                <span>{t.taskId}</span>
                <span className={t.status === 'running' ? 'text-green-400' : 'text-slate-400'}>{t.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="rounded-2xl border border-dark-border bg-dark-card p-5">
        <h2 className="text-sm text-slate-400 mb-3">移动端访问令牌</h2>
        {tokenStatus === null ? (
          <p className="text-sm text-slate-500">加载中...</p>
        ) : tokenStatus.hasToken ? (
          <div className="space-y-3">
            <p className="text-sm text-green-400">令牌已创建</p>
            {tokenStatus.lastUsedAt && (
              <p className="text-xs text-slate-500">
                最近使用: {new Date(tokenStatus.lastUsedAt).toLocaleString()}
              </p>
            )}
            <div className="flex gap-2">
              <button onClick={() => void handleRotateToken()} disabled={tokenLoading} className="rounded px-3 py-1 text-xs bg-yellow-600 text-white hover:bg-yellow-500 disabled:opacity-50">
                轮换令牌
              </button>
              <button onClick={() => void handleRevokeToken()} disabled={tokenLoading} className="rounded px-3 py-1 text-xs bg-red-600 text-white hover:bg-red-500 disabled:opacity-50">
                吊销令牌
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">尚未创建移动端令牌</p>
            <button onClick={() => void handleCreateToken()} disabled={tokenLoading} className="rounded px-3 py-1 text-xs bg-accent-blue text-white hover:bg-blue-500 disabled:opacity-50">
              创建令牌
            </button>
          </div>
        )}
        {newToken && (
          <div className="mt-3 rounded-lg border border-yellow-600/40 bg-yellow-900/20 p-3">
            <p className="text-xs text-yellow-400 mb-1">请复制令牌，此后将不再显示：</p>
            <code className="text-xs text-yellow-200 break-all select-all">{newToken}</code>
          </div>
        )}
      </div>
    </div>
  );
}
