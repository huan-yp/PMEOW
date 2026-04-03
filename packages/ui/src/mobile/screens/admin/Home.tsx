import { useState, useEffect } from 'react';
import { MobileSummaryCard } from '../../components/MobileSummaryCard.js';
import { MobilePageHeading } from '../../components/MobilePageHeading.js';
import { getAdminMobileSummary } from '../../api/admin.js';
import type { MobileAdminSummary } from '@monitor/core';

export function AdminHome() {
  const [summary, setSummary] = useState<MobileAdminSummary | null>(null);

  useEffect(() => {
    void getAdminMobileSummary().then(setSummary).catch(() => setSummary(null));
  }, []);

  if (!summary) {
    return (
      <div className="brand-card rounded-[24px] px-4 py-6">
        <p className="brand-kicker">overview</p>
        <p className="mt-2 text-sm text-slate-300">正在加载集群概览...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <MobilePageHeading
        kicker="overview"
        title="集群概览"
        description="用移动端快速查看在线节点、运行任务和队列压力，保持与 Web 控制台一致的监控视角。"
      />
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <MobileSummaryCard title="节点" value={summary.serverCount} subtitle={`${summary.onlineServerCount} 在线`} />
        </div>
        <MobileSummaryCard title="运行任务" value={summary.totalRunningTasks} />
        <MobileSummaryCard title="排队任务" value={summary.totalQueuedTasks} />
      </div>
    </div>
  );
}
