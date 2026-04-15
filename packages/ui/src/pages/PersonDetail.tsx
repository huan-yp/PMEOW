import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useTransport } from '../transport/TransportProvider.js';
import type { PersonRecord, PersonTimelinePoint, MirroredAgentTaskRecord, PersonBindingRecord, PersonSummaryItem } from '@monitor/core';
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

function formatTimeLabel(ts: number, periodHours: number): string {
  const d = new Date(ts);
  if (periodHours <= 24) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (periodHours <= 168) return d.toLocaleDateString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
}

function VramTimelineChart({ timeline, periodHours = 168 }: { timeline: PersonTimelinePoint[]; periodHours?: number }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const { points, maxMB, yTicks, xTicks } = useMemo(() => {
    const sorted = [...timeline].sort((a, b) => a.bucketStart - b.bucketStart);
    const max = Math.max(...sorted.map(t => t.totalVramMB), 1);
    // Round up to nice number
    const niceMax = max <= 1024 ? Math.ceil(max / 256) * 256
      : max <= 8192 ? Math.ceil(max / 1024) * 1024
      : Math.ceil(max / 4096) * 4096;

    const tickCount = 4;
    const yT = Array.from({ length: tickCount + 1 }, (_, i) => (niceMax / tickCount) * i);

    // X-axis: pick ~5 evenly spaced ticks
    const xTickCount = Math.min(5, sorted.length);
    const xT = xTickCount < 2 ? [0] : Array.from({ length: xTickCount }, (_, i) => Math.round((i / (xTickCount - 1)) * (sorted.length - 1)));

    return { points: sorted, maxMB: niceMax, yTicks: yT, xTicks: xT };
  }, [timeline]);

  if (points.length < 2) {
    const p = points[0];
    return (
      <div className="flex items-center justify-between text-sm text-slate-300 py-2">
        <span>{formatTimeLabel(p.bucketStart, periodHours)}</span>
        <span>{formatVramGB(p.totalVramMB)}</span>
      </div>
    );
  }

  const W = 600, H = 200, PAD_L = 52, PAD_R = 12, PAD_T = 8, PAD_B = 32;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const toX = (i: number) => PAD_L + (i / (points.length - 1)) * plotW;
  const toY = (mb: number) => PAD_T + plotH - (mb / maxMB) * plotH;

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.totalVramMB).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${toX(points.length - 1).toFixed(1)},${toY(0).toFixed(1)} L${toX(0).toFixed(1)},${toY(0).toFixed(1)} Z`;

  const taskLinePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.taskVramMB).toFixed(1)}`).join(' ');
  const taskAreaPath = `${taskLinePath} L${toX(points.length - 1).toFixed(1)},${toY(0).toFixed(1)} L${toX(0).toFixed(1)},${toY(0).toFixed(1)} Z`;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round(((svgX - PAD_L) / plotW) * (points.length - 1));
    setHoverIdx(Math.max(0, Math.min(points.length - 1, idx)));
  };

  const hp = hoverIdx !== null ? points[hoverIdx] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Y grid lines + labels */}
        {yTicks.map(mb => (
          <g key={mb}>
            <line x1={PAD_L} x2={W - PAD_R} y1={toY(mb)} y2={toY(mb)} stroke="#334155" strokeWidth={0.5} />
            <text x={PAD_L - 4} y={toY(mb) + 3} textAnchor="end" fill="#64748b" fontSize={9}>{formatVramGB(mb)}</text>
          </g>
        ))}
        {/* X labels */}
        {xTicks.map(idx => (
          <text key={idx} x={toX(idx)} y={H - 4} textAnchor="middle" fill="#64748b" fontSize={9}>
            {formatTimeLabel(points[idx].bucketStart, periodHours)}
          </text>
        ))}
        {/* Total area */}
        <path d={areaPath} fill="rgba(59,130,246,0.15)" />
        <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth={1.5} />
        {/* Task area */}
        <path d={taskAreaPath} fill="rgba(16,185,129,0.15)" />
        <path d={taskLinePath} fill="none" stroke="#10b981" strokeWidth={1} strokeDasharray="4,2" />
        {/* Hover crosshair */}
        {hoverIdx !== null && (
          <>
            <line x1={toX(hoverIdx)} x2={toX(hoverIdx)} y1={PAD_T} y2={PAD_T + plotH} stroke="#94a3b8" strokeWidth={0.5} strokeDasharray="3,2" />
            <circle cx={toX(hoverIdx)} cy={toY(hp!.totalVramMB)} r={3} fill="#3b82f6" />
            <circle cx={toX(hoverIdx)} cy={toY(hp!.taskVramMB)} r={2.5} fill="#10b981" />
          </>
        )}
      </svg>
      {/* Legend */}
      <div className="flex gap-4 mt-1 text-xs text-slate-400 px-1">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-blue-500 rounded" /> 总显存</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-emerald-500 rounded border-dashed" /> 任务显存</span>
      </div>
      {/* Tooltip */}
      {hp && (
        <div className="absolute top-0 right-0 rounded-lg bg-dark-card/90 border border-dark-border px-3 py-2 text-xs pointer-events-none">
          <p className="text-slate-400">{formatTimeLabel(hp.bucketStart, periodHours)}</p>
          <p className="text-blue-400">总计: {formatVramGB(hp.totalVramMB)}</p>
          <p className="text-emerald-400">任务: {formatVramGB(hp.taskVramMB)}</p>
          <p className="text-slate-500">其他: {formatVramGB(hp.nonTaskVramMB)}</p>
        </div>
      )}
    </div>
  );
}

export function PersonDetail() {
  const { id } = useParams<{ id: string }>();
  const transport = useTransport();
  const [person, setPerson] = useState<PersonRecord | null>(null);
  const [timeline, setTimeline] = useState<PersonTimelinePoint[]>([]);
  const [tasks, setTasks] = useState<MirroredAgentTaskRecord[]>([]);
  const [bindings, setBindings] = useState<PersonBindingRecord[]>([]);
  const [summary, setSummary] = useState<PersonSummaryItem | null>(null);
  const [period, setPeriod] = useState<24 | 168 | 720>(168);
  const [nodeDistribution, setNodeDistribution] = useState<Array<{ serverId: string; serverName: string; avgVramMB: number; maxVramMB: number; sampleCount: number }>>([]);
  const [peakPeriods, setPeakPeriods] = useState<Array<{ bucketStart: number; totalVramMB: number }>>([]);
  const [tokenStatus, setTokenStatus] = useState<{ hasToken: boolean; createdAt?: number; lastUsedAt?: number | null } | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    void transport.getPersons().then(all => setPerson(all.find(p => p.id === id) ?? null)).catch(() => setPerson(null));
    void transport.getPersonBindings(id).then(setBindings).catch(() => setBindings([]));
  }, [id, transport]);

  useEffect(() => {
    if (!id) return;
    void transport.getPersonSummary(period).then(all => setSummary(all.find(s => s.personId === id) ?? null)).catch(() => setSummary(null));
    void transport.getPersonTimeline(id, period).then(setTimeline).catch(() => setTimeline([]));
    void transport.getPersonTasks(id, period).then(setTasks).catch(() => setTasks([]));
    void adminFetch<Array<{ serverId: string; serverName: string; avgVramMB: number; maxVramMB: number; sampleCount: number }>>(
      `/api/persons/${encodeURIComponent(id)}/node-distribution?hours=${period}`,
    ).then(setNodeDistribution).catch(() => setNodeDistribution([]));
    void adminFetch<Array<{ bucketStart: number; totalVramMB: number }>>(
      `/api/persons/${encodeURIComponent(id)}/peak-periods?hours=${period}`,
    ).then(setPeakPeriods).catch(() => setPeakPeriods([]));
  }, [id, transport, period]);

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

      <div className="flex gap-2 mb-2">
        {([24, 168, 720] as const).map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
              period === p
                ? 'bg-accent-blue text-white'
                : 'bg-dark-card text-slate-400 hover:text-slate-200 border border-dark-border'
            }`}
          >
            {p === 24 ? '24h' : p === 168 ? '7d' : '30d'}
          </button>
        ))}
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <div className="rounded-2xl border border-dark-border bg-dark-card p-4 text-center">
          <p className="text-xs text-slate-400 mb-1">VRAM 占用时长</p>
          <p className="text-lg font-semibold text-slate-100">{summary ? `${summary.vramOccupancyHours.toFixed(1)}h` : '—'}</p>
        </div>
        <div className="rounded-2xl border border-dark-border bg-dark-card p-4 text-center">
          <p className="text-xs text-slate-400 mb-1">GB·h</p>
          <p className="text-lg font-semibold text-slate-100">{summary ? summary.vramGigabyteHours.toFixed(2) : '—'}</p>
        </div>
        <div className="rounded-2xl border border-dark-border bg-dark-card p-4 text-center">
          <p className="text-xs text-slate-400 mb-1">当前显存</p>
          <p className="text-lg font-semibold text-slate-100">{summary ? formatVramGB(summary.currentVramMB) : '—'}</p>
        </div>
        <div className="rounded-2xl border border-dark-border bg-dark-card p-4 text-center">
          <p className="text-xs text-slate-400 mb-1">运行任务</p>
          <p className="text-lg font-semibold text-slate-100">{summary ? summary.runningTaskCount : '—'}</p>
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
      </div>

      <div className="rounded-2xl border border-dark-border bg-dark-card p-5">
        <h2 className="text-sm text-slate-400 mb-3">显存时间线</h2>
        {timeline.length === 0 ? (
          <p className="text-sm text-slate-500">暂无数据</p>
        ) : (
          <VramTimelineChart timeline={timeline} periodHours={period} />
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-dark-border bg-dark-card p-5">
          <h2 className="text-sm text-slate-400 mb-3">节点 VRAM 分布</h2>
          {nodeDistribution.length === 0 ? (
            <p className="text-sm text-slate-500">暂无数据</p>
          ) : (
            <div className="space-y-2">
              {nodeDistribution.map(n => {
                const maxBar = Math.max(...nodeDistribution.map(d => d.maxVramMB), 1);
                return (
                  <div key={n.serverId} className="text-sm">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-slate-300 truncate" title={n.serverId}>{n.serverName}</span>
                      <span className="text-slate-400 ml-2 shrink-0">
                        均 {formatVramGB(n.avgVramMB)} / 峰 {formatVramGB(n.maxVramMB)}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-dark-border overflow-hidden">
                      <div
                        className="h-full rounded-full bg-accent-blue"
                        style={{ width: `${(n.maxVramMB / maxBar) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-dark-border bg-dark-card p-5">
          <h2 className="text-sm text-slate-400 mb-3">峰值时段 Top 3</h2>
          {peakPeriods.length === 0 ? (
            <p className="text-sm text-slate-500">暂无数据</p>
          ) : (
            <div className="space-y-2">
              {peakPeriods.map((p, i) => (
                <div key={p.bucketStart} className="flex items-center gap-3 text-sm">
                  <span className={`shrink-0 w-5 text-center font-medium ${i === 0 ? 'text-yellow-400' : 'text-slate-500'}`}>
                    #{i + 1}
                  </span>
                  <span className="text-slate-300">
                    {new Date(p.bucketStart).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="ml-auto text-slate-100 font-medium">{formatVramGB(p.totalVramMB)}</span>
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
