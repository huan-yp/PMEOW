import { useState, useEffect } from 'react';
import { getAdminMobileNotifications } from '../../api/admin.js';
import { MobileEmptyState } from '../../components/MobileEmptyState.js';
import { MobilePageHeading } from '../../components/MobilePageHeading.js';
import { NotificationsIcon } from '../../components/MobileIcons.js';

export function AdminNotifications() {
  const [alerts, setAlerts] = useState<any[]>([]);

  useEffect(() => {
    void getAdminMobileNotifications().then(setAlerts).catch(() => setAlerts([]));
  }, []);

  if (alerts.length === 0) {
    return (
      <MobileEmptyState
        icon={<NotificationsIcon className="h-6 w-6" />}
        title="暂无通知"
        description="告警和阈值变化会在这里集中展示。"
      />
    );
  }

  return (
    <div className="space-y-4">
      <MobilePageHeading
        kicker="notifications"
        title="通知"
        description="集中查看节点指标和阈值变动，快速发现需要处理的提醒。"
      />
      {alerts.map((a: any) => (
        <div key={a.id} className="brand-card rounded-[24px] p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-100">{a.metric}</span>
            <span className="ml-3 text-xs text-slate-500">{new Date(a.timestamp).toLocaleString()}</span>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-400">{a.serverName}: {a.value} (阈值 {a.threshold})</p>
        </div>
      ))}
    </div>
  );
}
