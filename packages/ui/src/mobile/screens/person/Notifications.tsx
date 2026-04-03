import { useState, useEffect } from 'react';
import { getPersonMobileNotifications, markNotificationRead } from '../../api/person.js';
import { MobileEmptyState } from '../../components/MobileEmptyState.js';
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

  if (items.length === 0) return <MobileEmptyState icon="🔔" title="暂无通知" />;

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold text-slate-100">通知</h1>
      {items.map(n => (
        <div
          key={n.id}
          className={`rounded-xl border border-dark-border bg-dark-card p-3 ${!n.readAt ? 'border-l-2 border-l-accent-blue' : ''}`}
          onClick={() => !n.readAt && void handleRead(n.id)}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-200">{n.title}</span>
            <span className="text-xs text-slate-500">{new Date(n.createdAt).toLocaleString()}</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">{n.body}</p>
        </div>
      ))}
    </div>
  );
}
