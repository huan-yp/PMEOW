import { useState, useEffect, useCallback } from 'react';
import { useTransport } from '../transport/TransportProvider.js';
import type { AlertRecord } from '@monitor/core';

const PAGE_SIZE = 50;

export function Alerts() {
  const transport = useTransport();
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [suppressingId, setSuppressingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await transport.getAlerts(PAGE_SIZE, offset);
      setAlerts(data);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [transport, offset]);

  useEffect(() => { load(); }, [load]);

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

  const formatTime = (ts: number) => new Date(ts).toLocaleString();

  const now = Date.now();

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-100">告警历史</h1>
        <p className="mt-1 text-sm text-slate-500">查看节点资源阈值告警及忽略状态。</p>
      </div>

      {loading ? (
        <div className="text-slate-500">加载中...</div>
      ) : alerts.length === 0 ? (
        <div className="text-slate-500">暂无告警记录</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-dark-border">
                <th className="pb-2 pr-4">时间</th>
                <th className="pb-2 pr-4">节点</th>
                <th className="pb-2 pr-4">指标</th>
                <th className="pb-2 pr-4">当前值</th>
                <th className="pb-2 pr-4">阈值</th>
                <th className="pb-2 pr-4">状态</th>
                <th className="pb-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => {
                const isSuppressed = a.suppressedUntil != null && a.suppressedUntil > now;
                return (
                  <tr key={a.id} className={`border-b border-dark-border/50 ${isSuppressed ? 'opacity-50' : ''}`}>
                    <td className="py-2 pr-4 text-slate-400 whitespace-nowrap">{formatTime(a.timestamp)}</td>
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
                      {!isSuppressed && (
                        <div className="flex gap-1">
                          {[1, 3, 7, 30].map(d => (
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
