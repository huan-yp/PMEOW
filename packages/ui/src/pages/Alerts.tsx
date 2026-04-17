import { useState, useEffect, useCallback, useRef } from 'react';
import { useTransport } from '../transport/TransportProvider.js';
import type { Alert, AlertQuery } from '../transport/types.js';

const PAGE_SIZE = 50;

type Tab = 'all' | 'active' | 'suppressed';
type SortCol = 'updatedAt' | 'serverId' | 'alertType' | 'value';

const TAB_LABELS: Record<Tab, string> = { all: '全部', active: '活跃', suppressed: '已忽略' };
const EMPTY_LABELS: Record<Tab, string> = {
  all: '暂无告警记录',
  active: '暂无活跃告警',
  suppressed: '暂无已忽略告警',
};

const TYPE_LABELS: Record<string, string> = {
  cpu: 'CPU 过高', memory: '内存过高', disk: '磁盘过高', gpu_temp: 'GPU 温度', offline: '节点离线',
};

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
  const [suppressingId, setSuppressingId] = useState<number | null>(null);
  const [unsuppressingId, setUnsuppressingId] = useState<number | null>(null);
  const [batchSuppressingDays, setBatchSuppressingDays] = useState<number | null>(null);
  const [batchUnsuppressing, setBatchUnsuppressing] = useState(false);

  const loadRef = useRef<() => Promise<void>>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query: AlertQuery = { limit: PAGE_SIZE, offset };
      if (tab === 'active') query.suppressed = false;
      else if (tab === 'suppressed') query.suppressed = true;
      const data = await transport.getAlerts(query);
      setAlerts(data);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [transport, tab, offset]);

  loadRef.current = load;

  useEffect(() => { load(); }, [load]);

  // Real-time: reload when a new alert arrives
  useEffect(() => {
    const unsub = transport.onAlert(() => { loadRef.current?.(); });
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

  const daysToUntil = (days: number) => Math.floor(Date.now() / 1000) + days * 86400;

  const handleSuppress = async (id: number, days: number) => {
    setSuppressingId(id);
    try {
      await transport.suppressAlert(id, daysToUntil(days));
      await load();
    } catch {
      // ignore
    }
    setSuppressingId(null);
  };

  const handleUnsuppress = async (id: number) => {
    setUnsuppressingId(id);
    try {
      await transport.unsuppressAlert(id);
      await load();
    } catch {
      // ignore
    }
    setUnsuppressingId(null);
  };

  const handleBatchSuppress = async (days: number) => {
    if (selectedIds.size === 0) return;
    setBatchSuppressingDays(days);
    try {
      await transport.batchSuppressAlerts([...selectedIds], daysToUntil(days));
      setSelectedIds(new Set());
      await load();
    } catch {
      // ignore
    }
    setBatchSuppressingDays(null);
  };

  const handleBatchUnsuppress = async () => {
    if (selectedIds.size === 0) return;
    setBatchUnsuppressing(true);
    try {
      await transport.batchUnsuppressAlerts([...selectedIds]);
      setSelectedIds(new Set());
      await load();
    } catch {
      // ignore
    }
    setBatchUnsuppressing(false);
  };

  const formatTime = (ts: number) => new Date(ts * 1000).toLocaleString('zh-CN');
  const now = Date.now() / 1000;

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
        <p className="mt-1 text-sm text-slate-500">查看节点资源阈值告警及忽略状态。</p>
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
          <span className="text-slate-500">批量忽略:</span>
          {[1, 3, 7, 30].map((d) => (
            <button
              key={d}
              onClick={() => handleBatchSuppress(d)}
              disabled={batchSuppressingDays !== null || batchUnsuppressing}
              className="px-2 py-0.5 text-xs border border-dark-border text-slate-400 rounded hover:bg-dark-hover hover:text-slate-200 transition-colors disabled:opacity-50"
            >
              {d}天
            </button>
          ))}
          <span className="text-slate-600">|</span>
          <button
            onClick={handleBatchUnsuppress}
            disabled={batchSuppressingDays !== null || batchUnsuppressing}
            className="px-2 py-0.5 text-xs border border-dark-border text-slate-400 rounded hover:bg-dark-hover hover:text-slate-200 transition-colors disabled:opacity-50"
          >
            批量取消忽略
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
                const isSuppressed = a.suppressedUntil != null && a.suppressedUntil > now;
                const isSelected = selectedIds.has(a.id);
                return (
                  <tr
                    key={a.id}
                    className={`border-b border-dark-border/50 ${
                      isSuppressed ? 'opacity-60' : ''
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
                    <td className="p-3 pr-4 font-mono text-accent-red">{a.value != null ? `${a.value.toFixed(1)}%` : '—'}</td>
                    <td className="p-3 pr-4 font-mono text-slate-500">{a.threshold != null ? `${a.threshold}%` : '—'}</td>
                    <td className="p-3 pr-4">
                      {isSuppressed ? (
                        <span className="text-xs text-slate-500">
                          已忽略至 {formatTime(a.suppressedUntil!)}
                        </span>
                      ) : (
                        <span className="text-xs text-accent-yellow">活跃</span>
                      )}
                    </td>
                    <td className="p-3">
                      {isSuppressed ? (
                        <button
                          onClick={() => handleUnsuppress(a.id)}
                          disabled={unsuppressingId === a.id}
                          aria-label={`取消忽略 ${a.id}`}
                          className="px-2 py-0.5 text-xs border border-dark-border text-slate-400 rounded hover:bg-dark-hover hover:text-slate-200 transition-colors disabled:opacity-50"
                        >
                          取消忽略
                        </button>
                      ) : (
                        <div className="flex gap-1">
                          {[1, 3, 7, 30].map((d) => (
                            <button
                              key={d}
                              onClick={() => handleSuppress(a.id, d)}
                              disabled={suppressingId === a.id}
                              className="px-2 py-0.5 text-xs border border-dark-border text-slate-400 rounded hover:bg-dark-hover hover:text-slate-200 transition-colors disabled:opacity-50"
                            >
                              {d}天
                            </button>
                          ))}
                        </div>
                      )}
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
