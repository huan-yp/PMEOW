import { useState, useEffect } from 'react';
import { useTransport } from '../transport/TransportProvider.js';
import type { Alert } from '../transport/types.js';

export default function Alerts() {
  const transport = useTransport();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    transport.getAlerts()
      .then(setAlerts)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };

  useEffect(load, [transport]);

  const handleSuppress = async (id: number) => {
    const until = Math.floor(Date.now() / 1000) + 7 * 86400; // 7 days
    try {
      await transport.suppressAlert(id, until);
      load();
    } catch { /* ignore */ }
  };

  const handleUnsuppress = async (id: number) => {
    try {
      await transport.unsuppressAlert(id);
      load();
    } catch { /* ignore */ }
  };

  const typeLabels: Record<string, string> = {
    cpu: 'CPU 过高', memory: '内存过高', disk: '磁盘过高', gpu_temp: 'GPU 温度', offline: '节点离线',
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="brand-kicker">告警管理</p>
        <h2 className="text-xl font-bold text-slate-100">告警列表</h2>
        <p className="mt-1 text-sm text-slate-500">同一节点同一类型仅保留一条（自动去重）</p>
      </div>

      {loading ? (
        <div className="text-center text-sm text-slate-500 py-8">加载中...</div>
      ) : alerts.length === 0 ? (
        <div className="rounded-2xl border border-dark-border bg-dark-card p-12 text-center text-slate-500">暂无告警</div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => {
            const isSuppressed = alert.suppressedUntil && alert.suppressedUntil > Date.now() / 1000;
            return (
              <div key={alert.id} className={`rounded-2xl border p-4 ${isSuppressed ? 'border-dark-border bg-dark-card/50 opacity-60' : 'border-accent-yellow/30 bg-accent-yellow/5'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-200">{typeLabels[alert.alertType] ?? alert.alertType}</span>
                      {isSuppressed && <span className="text-xs text-slate-500">（已忽略）</span>}
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      节点: {alert.serverId.slice(0, 8)}
                      {alert.value !== null && ` · 当前值: ${alert.value}`}
                      {alert.threshold !== null && ` · 阈值: ${alert.threshold}`}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      首次触发: {new Date(alert.createdAt * 1000).toLocaleString('zh-CN')}
                      {' · '}最后更新: {new Date(alert.updatedAt * 1000).toLocaleString('zh-CN')}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {isSuppressed ? (
                      <button onClick={() => handleUnsuppress(alert.id)} className="text-xs text-accent-blue hover:underline">取消忽略</button>
                    ) : (
                      <button onClick={() => handleSuppress(alert.id)} className="text-xs text-slate-400 hover:text-slate-200">忽略 7 天</button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
