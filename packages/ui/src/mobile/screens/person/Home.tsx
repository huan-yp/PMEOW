import { useState, useEffect } from 'react';
import { MobileSummaryCard } from '../../components/MobileSummaryCard.js';
import { MobilePageHeading } from '../../components/MobilePageHeading.js';
import { getPersonBootstrap } from '../../api/person.js';
import type { MobilePersonBootstrap } from '@monitor/core';

export function PersonHome() {
  const [data, setData] = useState<MobilePersonBootstrap | null>(null);

  useEffect(() => {
    void getPersonBootstrap().then(setData).catch(() => setData(null));
  }, []);

  if (!data) {
    return (
      <div className="brand-card rounded-[24px] px-4 py-6">
        <p className="brand-kicker">personal overview</p>
        <p className="mt-2 text-sm text-slate-300">正在加载你的个人概览...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <MobilePageHeading
        kicker="personal overview"
        title={`你好, ${data.person.displayName}`}
        description="在移动端继续你的个人任务流，查看运行状态、节点绑定和通知变化。"
      />
      <div className="grid grid-cols-2 gap-3">
        <MobileSummaryCard title="运行任务" value={data.runningTaskCount} />
        <MobileSummaryCard title="排队任务" value={data.queuedTaskCount} />
        <MobileSummaryCard title="绑定节点" value={data.boundNodeCount} />
        <MobileSummaryCard title="未读通知" value={data.unreadNotificationCount} />
      </div>
    </div>
  );
}
