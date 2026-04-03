import { useState, useEffect } from 'react';
import { getPersonMobileNotifications, markNotificationRead } from '../../api/person.js';
import { MobileEmptyState } from '../../components/MobileEmptyState.js';
import { MobilePageHeading } from '../../components/MobilePageHeading.js';
import { NotificationsIcon } from '../../components/MobileIcons.js';
import type { PersonMobileNotificationRecord } from '@monitor/core';

export function PersonNotifications() {
  const [items, setItems] = useState<PersonMobileNotificationRecord[]>([]);

  useEffect(() => {
    void getPersonMobileNotifications().then(setItems).catch(() => setItems([]));
  }, []);

  const handleRead = async (id: string) => {
    await markNotificationRead(id);
    setItems(prev => prev.map(n => n.id === id ? { ...n, readAt: Date.now() } : n));
  };

  if (items.length === 0) {
    return (
      <MobileEmptyState
        icon={<NotificationsIcon className="h-6 w-6" />}
        title="暂无通知"
        description="任务和节点相关提醒会在这里集中展示。"
      />
    );
  }

  return (
    <div className="space-y-4">
      <MobilePageHeading
        kicker="notifications"
        title="通知"
        description="集中查看与你相关的任务和节点动态，保持和 Web 端一致的提醒节奏。"
      />
      {items.map(n => (
        <div
          key={n.id}
          className={`brand-card rounded-[24px] p-4 transition-colors ${!n.readAt ? 'border border-accent-cyan/30 bg-accent-cyan/5' : ''}`}
          onClick={() => !n.readAt && void handleRead(n.id)}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-100">{n.title}</span>
            <span className="ml-3 text-xs text-slate-500">{new Date(n.createdAt).toLocaleString()}</span>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-400">{n.body}</p>
        </div>
      ))}
    </div>
  );
}
