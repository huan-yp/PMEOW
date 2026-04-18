import { useState, useEffect, useCallback, useRef } from 'react';
import { useTransport } from '../transport/TransportProvider.js';
import type { Alert, AlertQuery, AlertStatus } from '../transport/types.js';

const PAGE_SIZE = 50;

type Tab = 'all' | 'active' | 'resolved' | 'silenced';
type SortCol = 'updatedAt' | 'serverId' | 'alertType' | 'value';

const TAB_LABELS: Record<Tab, string> = { all: '全部', active: '活跃', resolved: '已恢复', silenced: '已静默' };
const EMPTY_LABELS: Record<Tab, string> = {
  all: '暂无告警记录',
  active: '暂无活跃告警',
  resolved: '暂无已恢复告警',
  silenced: '暂无已静默告警',
};

const STATUS_LABELS: Record<AlertStatus, string> = { active: '告警中', resolved: '已恢复', silenced: '已静默' };
const STATUS_COLORS: Record<AlertStatus, string> = {
  active: 'text-accent-yellow',
  resolved: 'text-green-400',
  silenced: 'text-slate-500',
};

const TYPE_LABELS: Record<string, string> = {
  cpu: 'CPU 过高', memory: '内存过高', disk: '磁盘过高', gpu_temp: 'GPU 温度', offline: '节点离线', gpu_idle_memory: 'GPU 显存空占',
};

function formatAlertNumber(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function formatAlertValue(alert: Alert): string {
  if (alert.value == null) {
    return '—';
  }

  switch (alert.alertType) {
    case 'gpu_temp':
      return `${formatAlertNumber(alert.value)}°C`;
    case 'offline':
      return `${formatAlertNumber(alert.value)}秒`;
    case 'cpu':
    case 'memory':
    case 'disk':
    case 'gpu_idle_memory':
    default:
      return `${formatAlertNumber(alert.value)}%`;
  }
}

function formatAlertThreshold(alert: Alert): string {
  if (alert.threshold == null) {
    return '—';
  }

  switch (alert.alertType) {
    case 'gpu_temp':
      return `${formatAlertNumber(alert.threshold)}°C`;
    case 'offline':
      return `${formatAlertNumber(alert.threshold)}秒`;
    case 'cpu':
    case 'memory':
    case 'disk':
    case 'gpu_idle_memory':
    default:
      return `${formatAlertNumber(alert.threshold)}%`;
  }
}

function getAlertStatusLabel(alert: Alert): string {
  return STATUS_LABELS[alert.status] ?? alert.status;
}

function toDisplayDate(ts: number): Date {
  return new Date(ts < 1_000_000_000_000 ? ts * 1000 : ts);
}

function sortAlerts(alerts: Alert[], col: SortCol, dir: 'asc' | 'desc'): Alert[] {
  return [...alerts].sort((a, b) => {
    let cmp = 0;
    if (col === 'updatedAt') cmp = a.updatedAt - b.updatedAt;
    else if (col === 'serverId') cmp = a.serverId.localeCompare(b.serverId);
    else if (col === 'alertType') cmp = a.alertType.localeCompare(b.alertType);
    else if (col === 'value') cmp = (a.value ?? 0) - (b.value ?? 0);
    return dir === 'asc' ? cmp : -cmp;
  });
}

export default function Alerts() {
  const transport = useTransport();

  const [tab, setTab] = useState<Tab>('all');
  const [offset, setOffset] = useState(0);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [sortCol, setSortCol] = useState<SortCol>('updatedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [silencingId, setSilencingId] = useState<number | null>(null);
  const [unsilencingId, setUnsilencingId] = useState<number | null>(null);
  const [batchSilencing, setBatchSilencing] = useState(false);
  const [batchUnsilencing, setBatchUnsilencing] = useState(false);

  const loadRef = useRef<() => Promise<void>>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query: AlertQuery = { limit: PAGE_SIZE, offset };
      if (tab !== 'all') query.status = tab as AlertStatus;
      const data = await transport.getAlerts(query);
      setAlerts(data);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [transport, tab, offset]);

  loadRef.current = load;

  useEffect(() => { load(); }, [load]);

  // Real-time: reload when alert state changes
  useEffect(() => {
    const unsub = transport.onAlertStateChange(() => { loadRef.current?.(); });
    return unsub;
  }, [transport]);

  const handleTabChange = (t: Tab) => {
    setTab(t);
    setOffset(0);
    setSelectedIds(new Set());
    setSearchQuery('');
  };

  const handleSort = (col: SortCol) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
  };

  const handleSilence = async (id: number) => {
    setSilencingId(id);
    try {
      await transport.silenceAlert(id);
      await load();
    } catch {
      // ignore
    }
    setSilencingId(null);
  };

  const handleUnsilence = async (id: number) => {
    setUnsilencingId(id);
    try {
      await transport.unsilenceAlert(id);
      await load();
    } catch {
      // ignore
    }
    setUnsilencingId(null);
  };

  const handleBatchSilence = async () => {
    if (selectedIds.size === 0) return;
    setBatchSilencing(true);
    try {
      await transport.batchSilenceAlerts([...selectedIds]);
      setSelectedIds(new Set());
      await load();
    } catch {
      // ignore
    }
    setBatchSilencing(false);
  };

  const handleBatchUnsilence = async () => {
    if (selectedIds.size === 0) return;
    setBatchUnsilencing(true);
    try {
      await transport.batchUnsilenceAlerts([...selectedIds]);
      setSelectedIds(new Set());
      await load();
    } catch {
      // ignore
    }
    setBatchUnsilencing(false);
  };

  const formatTime = (ts: number) => toDisplayDate(ts).toLocaleString('zh-CN');

  // Client-side search filter
  const q = searchQuery.trim().toLowerCase();
  const filtered = q
    ? alerts.filter(
        (a) => a.serverId.toLowerCase().includes(q) || a.alertType.toLowerCase().includes(q) || (TYPE_LABELS[a.alertType] ?? '').includes(q),
      )
    : alerts;

  const sorted = sortAlerts(filtered, sortCol, sortDir);

  // Multi-select helpers
  const allVisibleIds = sorted.map((a) => a.id);
  const allSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedIds.has(id));
  const someSelected = !allSelected && allVisibleIds.some((id) => selectedIds.has(id));

  const toggleRow = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of allVisibleIds) next.delete(id);
        return next;
      });
    } else {
      setSelectedIds((prev) => new Set([...prev, ...allVisibleIds]));
    }
  };

  const SortIndicator = ({ col }: { col: SortCol }) =>
    sortCol === col ? (
      <span className="ml-1 text-accent-blue">{sortDir === 'asc' ? '↑' : '↓'}</span>
    ) : null;

  const thClass =
    'pb-2 pr-4 text-xs font-medium text-slate-500 cursor-pointer select-none hover:text-slate-300 transition-colors';

  return (
    <div className="space-y-6">
      <div>
        <p className="brand-kicker">告警管理</p>
        <h2 className="text-xl font-bold text-slate-100">告警历史</h2>
        <p className="mt-1 text-sm text-slate-500">查看节点阈值告警、离线告警及忽略状态。</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-dark-border">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => handleTabChange(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t
                ? 'border-b-2 border-accent-blue text-slate-100 -mb-px'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Search bar */}
      <div>
        <input
          type="text"
          aria-label="search"
          placeholder="搜索节点或指标…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-64 px-3 py-1.5 text-sm bg-dark-card border border-dark-border rounded-lg text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-blue"
        />
      </div>

      {/* Batch action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-3 py-2 bg-dark-card border border-dark-border rounded-lg text-sm">
          <span className="text-slate-400">已选 {selectedIds.size} 条</span>
          <span className="text-slate-600">|</span>
          <button
            onClick={handleBatchSilence}
            disabled={batchSilencing || batchUnsilencing}
            className="px-2 py-0.5 text-xs border border-dark-border text-slate-400 rounded hover:bg-dark-hover hover:text-slate-200 transition-colors disabled:opacity-50"
          >
            批量静默
          </button>
          <button
            onClick={handleBatchUnsilence}
            disabled={batchSilencing || batchUnsilencing}
            className="px-2 py-0.5 text-xs border border-dark-border text-slate-400 rounded hover:bg-dark-hover hover:text-slate-200 transition-colors disabled:opacity-50"
          >
            批量取消静默
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-slate-500 py-8 text-center text-sm">加载中...</div>
      ) : sorted.length === 0 ? (
        <div className="rounded-2xl border border-dark-border bg-dark-card p-12 text-center text-slate-500">{EMPTY_LABELS[tab]}</div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-dark-border bg-dark-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-dark-border">
                <th className="p-3 pr-2">
                  <input
                    type="checkbox"
                    aria-label="全选"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={toggleAll}
                    className="accent-accent-blue cursor-pointer"
                  />
                </th>
                <th className={`p-3 ${thClass}`} onClick={() => handleSort('updatedAt')}>
                  时间
                  <SortIndicator col="updatedAt" />
                </th>
                <th className={`p-3 ${thClass}`} onClick={() => handleSort('serverId')}>
                  节点
                  <SortIndicator col="serverId" />
                </th>
                <th className={`p-3 ${thClass}`} onClick={() => handleSort('alertType')}>
                  指标
                  <SortIndicator col="alertType" />
                </th>
                <th className={`p-3 ${thClass}`} onClick={() => handleSort('value')}>
                  当前值
                  <SortIndicator col="value" />
                </th>
                <th className="p-3 pb-2 pr-4 text-xs font-medium text-slate-500">阈值</th>
                <th className="p-3 pb-2 pr-4 text-xs font-medium text-slate-500">状态</th>
                <th className="p-3 pb-2 text-xs font-medium text-slate-500">操作</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => {
                const isSelected = selectedIds.has(a.id);
                return (
                  <tr
                    key={a.id}
                    className={`border-b border-dark-border/50 ${
                      a.status === 'silenced' ? 'opacity-60' : ''
                    } ${isSelected ? 'bg-dark-hover/30' : ''}`}
                  >
                    <td className="p-3 pr-2">
                      <input
                        type="checkbox"
                        aria-label={`选择 ${a.id}`}
                        checked={isSelected}
                        onChange={() => toggleRow(a.id)}
                        className="accent-accent-blue cursor-pointer"
                      />
                    </td>
                    <td className="p-3 pr-4 text-slate-400 whitespace-nowrap">
                      {formatTime(a.updatedAt)}
                    </td>
                    <td className="p-3 pr-4 text-slate-200 font-mono">{a.serverId.slice(0, 8)}</td>
                    <td className="p-3 pr-4 text-slate-300">{TYPE_LABELS[a.alertType] ?? a.alertType}</td>
                    <td className="p-3 pr-4 font-mono text-accent-red">
                      {a.alertType === 'gpu_idle_memory' && a.details
                        ? <GpuIdleDetails details={a.details} />
                        : formatAlertValue(a)}
                    </td>
                    <td className="p-3 pr-4 font-mono text-slate-500">{formatAlertThreshold(a)}</td>
                    <td className="p-3 pr-4">
                      <span className={`text-xs ${STATUS_COLORS[a.status]}`}>
                        {getAlertStatusLabel(a)}
                      </span>
                    </td>
                    <td className="p-3">
                      {a.status === 'silenced' ? (
                        <button
                          onClick={() => handleUnsilence(a.id)}
                          disabled={unsilencingId === a.id}
                          aria-label={`取消静默 ${a.id}`}
                          className="px-2 py-0.5 text-xs border border-dark-border text-slate-400 rounded hover:bg-dark-hover hover:text-slate-200 transition-colors disabled:opacity-50"
                        >
                          取消静默
                        </button>
                      ) : a.status === 'active' ? (
                        <button
                          onClick={() => handleSilence(a.id)}
                          disabled={silencingId === a.id}
                          className="px-2 py-0.5 text-xs border border-dark-border text-slate-400 rounded hover:bg-dark-hover hover:text-slate-200 transition-colors disabled:opacity-50"
                        >
                          静默
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {!loading && sorted.length > 0 && (
        <div className="flex gap-2">
          <button
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0}
            className="px-3 py-1.5 text-xs border border-dark-border text-slate-400 rounded-lg hover:bg-dark-hover disabled:opacity-30"
          >
            上一页
          </button>
          <button
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={alerts.length < PAGE_SIZE}
            className="px-3 py-1.5 text-xs border border-dark-border text-slate-400 rounded-lg hover:bg-dark-hover disabled:opacity-30"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}

function GpuIdleDetails({ details }: { details: Record<string, unknown> }) {
  const gpu = details.gpuIndex as number | undefined;
  const pid = details.pid as number | undefined;
  const user = details.user as string | undefined;
  const command = details.command as string | undefined;
  const vram = details.vramMb as number | undefined;
  const duration = details.durationSeconds as number | undefined;

  const durationText = duration != null
    ? duration >= 60 ? `${Math.floor(duration / 60)}分${duration % 60}秒` : `${duration}秒`
    : undefined;

  const cmdShort = command && command.length > 40 ? command.slice(0, 40) + '…' : command;

  return (
    <span className="text-xs leading-relaxed">
      <span className="text-accent-red">GPU{gpu}</span>
      {' · '}
      <span className="text-slate-300">{user ?? '?'}</span>
      {' · PID '}
      <span className="text-slate-200">{pid ?? '?'}</span>
      {vram != null && <>{' · '}<span className="text-slate-300">{Math.round(vram)}MB</span></>}
      {durationText && <>{' · '}<span className="text-slate-400">{durationText}</span></>}
      {cmdShort && <div className="text-slate-500 truncate max-w-xs" title={command}>{cmdShort}</div>}
    </span>
  );
}
