import { useState, useEffect } from 'react';
import { MobileSummaryCard } from '../../components/MobileSummaryCard.js';
import { getPersonBootstrap } from '../../api/person.js';
import type { MobilePersonBootstrap } from '@monitor/core';

export function PersonHome() {
  const [data, setData] = useState<MobilePersonBootstrap | null>(null);

  useEffect(() => {
    void getPersonBootstrap().then(setData).catch(() => setData(null));
  }, []);

  if (!data) return <p className="text-sm text-slate-400">加载中...</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-slate-100">你好, {data.person.displayName}</h1>
      <div className="grid grid-cols-2 gap-3">
        <MobileSummaryCard title="运行任务" value={data.runningTaskCount} />
        <MobileSummaryCard title="排队任务" value={data.queuedTaskCount} />
        <MobileSummaryCard title="绑定节点" value={data.boundNodeCount} />
        <MobileSummaryCard title="未读通知" value={data.unreadNotificationCount} />
      </div>
    </div>
  );
}
