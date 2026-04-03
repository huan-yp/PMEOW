import { useState, useEffect } from 'react';
import { getAdminMobileNotifications } from '../../api/admin.js';
import { MobileEmptyState } from '../../components/MobileEmptyState.js';

export function AdminNotifications() {
  const [alerts, setAlerts] = useState<any[]>([]);

  useEffect(() => {
    void getAdminMobileNotifications().then(setAlerts).catch(() => setAlerts([]));
  }, []);

  if (alerts.length === 0) return <MobileEmptyState icon="🔔" title="暂无通知" />;

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold text-slate-100">通知</h1>
      {alerts.map((a: any) => (
        <div key={a.id} className="rounded-xl border border-dark-border bg-dark-card p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-200">{a.metric}</span>
            <span className="text-xs text-slate-500">{new Date(a.timestamp).toLocaleString()}</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">{a.serverName}: {a.value} (阈值 {a.threshold})</p>
        </div>
      ))}
    </div>
  );
}
