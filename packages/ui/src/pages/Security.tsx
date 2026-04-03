import { useEffect, useMemo, useState } from 'react';
import type { SecurityEventRecord } from '@monitor/core';
import { useTransport } from '../transport/TransportProvider.js';
import type { SecurityEventQuery } from '../transport/types.js';

const DEFAULT_HOURS = 168;

type ResolvedFilter = '' | 'true' | 'false';

interface FilterState {
  serverId: string;
  resolved: ResolvedFilter;
  hours: string;
}

function buildQuery(filters: FilterState): SecurityEventQuery {
  const query: SecurityEventQuery = {};
  const serverId = filters.serverId.trim();
  const hours = Number(filters.hours);

  if (serverId) {
    query.serverId = serverId;
  }

  if (filters.resolved === 'true') {
    query.resolved = true;
  }

  if (filters.resolved === 'false') {
    query.resolved = false;
  }

  if (Number.isFinite(hours) && hours > 0) {
    query.hours = hours;
  }

  return query;
}

function formatEventType(eventType: SecurityEventRecord['eventType']) {
  switch (eventType) {
    case 'suspicious_process':
      return '可疑进程';
    case 'unowned_gpu':
      return '未知 GPU 占用';
    case 'marked_safe':
      return '已标记安全';
    default:
      return eventType;
  }
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

function canMarkEventSafe(event: SecurityEventRecord) {
  return !event.resolved && event.eventType !== 'marked_safe';
}

export function Security() {
  const transport = useTransport();
  const [filters, setFilters] = useState<FilterState>({
    serverId: '',
    resolved: 'false',
    hours: String(DEFAULT_HOURS),
  });
  const [appliedQuery, setAppliedQuery] = useState<SecurityEventQuery>({ resolved: false, hours: DEFAULT_HOURS });
  const [events, setEvents] = useState<SecurityEventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [resolvingId, setResolvingId] = useState<number | null>(null);

  useEffect(() => {
    const unsubscribe = transport.onSecurityEvent(() => {
      setReloadToken((value) => value + 1);
    });

    return unsubscribe;
  }, [transport]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const nextEvents = await transport.getSecurityEvents(appliedQuery);
        if (!cancelled) {
          setEvents(nextEvents);
        }
      } catch {
        if (!cancelled) {
          setEvents([]);
        }
      }
      if (!cancelled) {
        setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [transport, appliedQuery, reloadToken]);

  const resultsLabel = useMemo(() => {
    if (loading) {
      return '加载中...';
    }
    return `共 ${events.length} 条事件`;
  }, [events.length, loading]);

  const applyFilters = () => {
    setAppliedQuery(buildQuery(filters));
  };

  const handleMarkSafe = async (eventId: number) => {
    setResolvingId(eventId);
    try {
      await transport.markSecurityEventSafe(eventId);
      setReloadToken((value) => value + 1);
    } catch {
      return;
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">安全审计</h1>
          <p className="mt-1 text-sm text-slate-500">筛选并处理节点安全事件与 GPU 归属异常。</p>
        </div>
        <div className="text-sm text-slate-500">{resultsLabel}</div>
      </div>

      <section className="rounded-lg border border-dark-border bg-dark-card p-4 shadow-sm">
        <div className="grid gap-4 md:grid-cols-4">
          <label className="text-sm text-slate-400">
            <span className="mb-1 block">节点 ID</span>
            <input
              aria-label="serverId"
              value={filters.serverId}
              onChange={(event) => setFilters((current) => ({ ...current, serverId: event.target.value }))}
              className="w-full rounded border border-dark-border bg-dark-bg px-3 py-2 text-sm text-slate-200 focus:border-accent-blue focus:outline-none"
              placeholder="node-1"
            />
          </label>

          <label className="text-sm text-slate-400">
            <span className="mb-1 block">处理状态</span>
            <select
              aria-label="resolved"
              value={filters.resolved}
              onChange={(event) => setFilters((current) => ({ ...current, resolved: event.target.value as ResolvedFilter }))}
              className="w-full rounded border border-dark-border bg-dark-bg px-3 py-2 text-sm text-slate-200 focus:border-accent-blue focus:outline-none"
            >
              <option value="">全部</option>
              <option value="false">未处理</option>
              <option value="true">已处理</option>
            </select>
          </label>

          <label className="text-sm text-slate-400">
            <span className="mb-1 block">时间范围 (小时)</span>
            <input
              aria-label="hours"
              type="number"
              min="1"
              value={filters.hours}
              onChange={(event) => setFilters((current) => ({ ...current, hours: event.target.value }))}
              className="w-full rounded border border-dark-border bg-dark-bg px-3 py-2 text-sm text-slate-200 focus:border-accent-blue focus:outline-none"
            />
          </label>

          <div className="flex items-end">
            <button
              type="button"
              onClick={applyFilters}
              className="w-full rounded border border-dark-border px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-dark-hover"
            >
              更新视图
            </button>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="text-sm text-slate-500">加载中...</div>
      ) : events.length === 0 ? (
        <div className="rounded-lg border border-dark-border bg-dark-card p-6 text-sm text-slate-500">
          当前筛选条件下暂无安全事件
        </div>
      ) : (
        <section className="overflow-x-auto rounded-lg border border-dark-border bg-dark-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-border text-left text-xs text-slate-500">
                <th className="px-4 py-3">时间</th>
                <th className="px-4 py-3">节点 ID</th>
                <th className="px-4 py-3">类型</th>
                <th className="px-4 py-3">详情</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b border-dark-border/50 align-top last:border-b-0">
                  <td className="px-4 py-3 text-slate-400">{formatTimestamp(event.createdAt)}</td>
                  <td className="px-4 py-3 font-mono text-slate-300">{event.serverId}</td>
                  <td className="px-4 py-3 text-slate-300">{formatEventType(event.eventType)}</td>
                  <td className="px-4 py-3 text-slate-300">
                    <div>{event.details.reason}</div>
                    {event.details.command ? (
                      <div className="mt-1 font-mono text-xs text-slate-500">{event.details.command}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {event.resolved ? '已处理' : '未处理'}
                  </td>
                  <td className="px-4 py-3">
                    {canMarkEventSafe(event) ? (
                      <button
                        type="button"
                        aria-label={`标记安全 ${event.id}`}
                        onClick={() => handleMarkSafe(event.id)}
                        disabled={resolvingId === event.id}
                        className="rounded border border-dark-border px-2 py-1 text-xs text-slate-300 transition-colors hover:bg-dark-hover disabled:opacity-50"
                      >
                        标记安全
                      </button>
                    ) : (
                      <span className="text-xs text-slate-500">已标记</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}