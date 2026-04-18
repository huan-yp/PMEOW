import { useState, useEffect } from 'react';
import { useTransport } from '../transport/TransportProvider.js';
import type { SecurityEvent } from '../transport/types.js';

export default function Security() {
  const transport = useTransport();
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    transport.getSecurityEvents({ resolved: showResolved ? undefined : false })
      .then(setEvents)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };

  useEffect(load, [transport, showResolved]);

  const handleMarkSafe = async (id: number) => {
    try { await transport.markSecurityEventSafe(id); load(); } catch { /* ignore */ }
  };

  const handleUnresolve = async (id: number) => {
    try { await transport.unresolveSecurityEvent(id); load(); } catch { /* ignore */ }
  };

  const typeLabels: Record<string, string> = {
    suspicious_process: '可疑进程',
    unowned_gpu: '未归属 GPU',
    high_gpu_utilization: '高 GPU 利用率',
    marked_safe: '已标记安全',
    unresolve: '重新打开',
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="brand-kicker">安全审计</p>
        <h2 className="text-xl font-bold text-slate-100">安全事件</h2>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowResolved(!showResolved)}
          className={`rounded-full px-3 py-1.5 text-xs transition-colors ${showResolved ? 'bg-accent-blue text-white' : 'border border-dark-border bg-dark-card text-slate-300'}`}
        >
          {showResolved ? '显示全部' : '仅未解决'}
        </button>
      </div>

      {loading ? (
        <div className="text-center text-sm text-slate-500 py-8">加载中...</div>
      ) : events.length === 0 ? (
        <div className="rounded-2xl border border-dark-border bg-dark-card p-12 text-center text-slate-500">暂无安全事件</div>
      ) : (
        <div className="space-y-3">
          {events.map((evt) => (
            <div key={evt.id} className={`rounded-2xl border p-4 ${evt.resolved ? 'border-dark-border bg-dark-card/50 opacity-60' : 'border-accent-red/30 bg-accent-red/5'}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="text-sm font-medium text-slate-200">{typeLabels[evt.eventType] ?? evt.eventType}</span>
                  <p className="mt-1 text-xs text-slate-400">节点: {evt.serverId.slice(0, 8)} · 指纹: {evt.fingerprint}</p>
                  <p className="mt-1 text-xs text-slate-500">{new Date(evt.createdAt * 1000).toLocaleString('zh-CN')}</p>
                </div>
                <div className="flex gap-2">
                  {evt.resolved ? (
                    <button onClick={() => handleUnresolve(evt.id)} className="text-xs text-accent-yellow hover:underline">重新打开</button>
                  ) : (
                    <button onClick={() => handleMarkSafe(evt.id)} className="text-xs text-accent-green hover:underline">标记安全</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
