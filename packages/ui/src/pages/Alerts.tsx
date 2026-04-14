import { useState, useEffect, useCallback, useRef } from 'react';
import { useTransport } from '../transport/TransportProvider.js';
import type { AlertQuery } from '../transport/types.js';
import type { AlertRecord } from '@monitor/core';

const PAGE_SIZE = 50;

type Tab = 'all' | 'active' | 'suppressed';
type SortCol = 'timestamp' | 'serverName' | 'metric' | 'value';

const TAB_LABELS: Record<Tab, string> = { all: '全部', active: '活跃', suppressed: '已忽略' };
const EMPTY_LABELS: Record<Tab, string> = {
  all: '暂无告警记录',
  active: '暂无活跃告警',
  suppressed: '暂无已忽略告警',
};

function sortAlerts(
  alerts: AlertRecord[],
  col: SortCol,
  dir: 'asc' | 'desc',
): AlertRecord[] {
  return [...alerts].sort((a, b) => {
    let cmp = 0;
    if (col === 'timestamp') cmp = a.timestamp - b.timestamp;
    else if (col === 'serverName') cmp = a.serverName.localeCompare(b.serverName);
    else if (col === 'metric') cmp = a.metric.localeCompare(b.metric);
    else if (col === 'value') cmp = a.value - b.value;
    return dir === 'asc' ? cmp : -cmp;
  });
}

export function Alerts() {
  const transport = useTransport();

  const [tab, setTab] = useState<Tab>('all');
  const [offset, setOffset] = useState(0);
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [sortCol, setSortCol] = useState<SortCol>('timestamp');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [suppressingId, setSuppressingId] = useState<string | null>(null);
  const [unsuppressingId, setUnsuppressingId] = useState<string | null>(null);
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

  const handleSuppress = async (id: string, days: number) => {
    setSuppressingId(id);
    try {
      await transport.suppressAlert(id, days);
      await load();
    } catch {
      // ignore
    }
    setSuppressingId(null);
  };

  const handleUnsuppress = async (id: string) => {
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
      await transport.batchSuppressAlerts([...selectedIds], days);
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

  const formatTime = (ts: number) => new Date(ts).toLocaleString();
  const now = Date.now();

  // Client-side search filter
  const q = searchQuery.trim().toLowerCase();
  const filtered = q
    ? alerts.filter(
        (a) => a.serverName.toLowerCase().includes(q) || a.metric.toLowerCase().includes(q),
      )
    : alerts;

  const sorted = sortAlerts(filtered, sortCol, sortDir);

  // Multi-select helpers
  const allVisibleIds = sorted.map((a) => a.id);
  const allSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedIds.has(id));
  const someSelected = !allSelected && allVisibleIds.some((id) => selectedIds.has(id));

  const toggleRow = (id: string) => {
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
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-100">告警历史</h1>
        <p className="mt-1 text-sm text-slate-500">查看节点资源阈值告警及忽略状态。</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-dark-border mb-4">
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
      <div className="mb-4">
        <input
          type="text"
          aria-label="search"
          placeholder="搜索节点或指标…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-64 px-3 py-1.5 text-sm bg-dark-card border border-dark-border rounded text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-blue"
        />
      </div>

      {/* Batch action bar */}
      {selectedIds.size > 0 && (
        <div className="mb-3 flex items-center gap-3 px-3 py-2 bg-dark-card border border-dark-border rounded text-sm">
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
        <div className="text-slate-500">加载中...</div>
      ) : sorted.length === 0 ? (
        <div className="text-slate-500">{EMPTY_LABELS[tab]}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-dark-border">
                <th className="pb-2 pr-3">
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
                <th className={thClass} onClick={() => handleSort('timestamp')}>
                  时间
                  <SortIndicator col="timestamp" />
                </th>
                <th className={thClass} onClick={() => handleSort('serverName')}>
                  节点
                  <SortIndicator col="serverName" />
                </th>
                <th className={thClass} onClick={() => handleSort('metric')}>
                  指标
                  <SortIndicator col="metric" />
                </th>
                <th className={thClass} onClick={() => handleSort('value')}>
                  当前值
                  <SortIndicator col="value" />
                </th>
                <th className="pb-2 pr-4 text-xs font-medium text-slate-500">阈值</th>
                <th className="pb-2 pr-4 text-xs font-medium text-slate-500">状态</th>
                <th className="pb-2 text-xs font-medium text-slate-500">操作</th>
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
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        aria-label={`选择 ${a.id}`}
                        checked={isSelected}
                        onChange={() => toggleRow(a.id)}
                        className="accent-accent-blue cursor-pointer"
                      />
                    </td>
                    <td className="py-2 pr-4 text-slate-400 whitespace-nowrap">
                      {formatTime(a.timestamp)}
                    </td>
                    <td className="py-2 pr-4 text-slate-200">{a.serverName}</td>
                    <td className="py-2 pr-4 text-slate-300 font-mono">{a.metric}</td>
                    <td className="py-2 pr-4 font-mono text-accent-red">{a.value.toFixed(1)}%</td>
                    <td className="py-2 pr-4 font-mono text-slate-500">{a.threshold}%</td>
                    <td className="py-2 pr-4">
                      {isSuppressed ? (
                        <span className="text-xs text-slate-500">
                          已忽略至 {formatTime(a.suppressedUntil!)}
                        </span>
                      ) : (
                        <span className="text-xs text-accent-yellow">活跃</span>
                      )}
                    </td>
                    <td className="py-2">
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
      <div className="flex gap-2 mt-4">
        <button
          onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          disabled={offset === 0}
          className="px-3 py-1.5 text-xs border border-dark-border text-slate-400 rounded hover:bg-dark-hover disabled:opacity-30"
        >
          上一页
        </button>
        <button
          onClick={() => setOffset(offset + PAGE_SIZE)}
          disabled={alerts.length < PAGE_SIZE}
          className="px-3 py-1.5 text-xs border border-dark-border text-slate-400 rounded hover:bg-dark-hover disabled:opacity-30"
        >
          下一页
        </button>
      </div>
    </div>
  );
}
