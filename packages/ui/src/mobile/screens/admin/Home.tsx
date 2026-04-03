import { useState, useEffect } from 'react';
import { MobileSummaryCard } from '../../components/MobileSummaryCard.js';
import { getAdminMobileSummary } from '../../api/admin.js';
import type { MobileAdminSummary } from '@monitor/core';

export function AdminHome() {
  const [summary, setSummary] = useState<MobileAdminSummary | null>(null);

  useEffect(() => {
    void getAdminMobileSummary().then(setSummary).catch(() => setSummary(null));
  }, []);

  if (!summary) return <p className="text-sm text-slate-400">加载中...</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-slate-100">集群概览</h1>
      <div className="grid grid-cols-2 gap-3">
        <MobileSummaryCard title="节点" value={summary.serverCount} subtitle={`${summary.onlineServerCount} 在线`} />
        <MobileSummaryCard title="运行任务" value={summary.totalRunningTasks} />
        <MobileSummaryCard title="排队任务" value={summary.totalQueuedTasks} />
      </div>
    </div>
  );
}
