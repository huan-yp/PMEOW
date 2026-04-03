import { useState, useEffect } from 'react';
import { getAdminMobileTasks } from '../../api/admin.js';
import { MobileEmptyState } from '../../components/MobileEmptyState.js';

export function AdminTasks() {
  const [tasks, setTasks] = useState<any[]>([]);

  useEffect(() => {
    void getAdminMobileTasks().then(setTasks).catch(() => setTasks([]));
  }, []);

  if (tasks.length === 0) return <MobileEmptyState icon="📋" title="暂无任务" />;

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold text-slate-100">任务列表</h1>
      {tasks.map((t: any) => (
        <div key={t.taskId} className="rounded-xl border border-dark-border bg-dark-card p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-200 truncate flex-1">{t.command || t.taskId}</span>
            <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
              t.status === 'running' ? 'bg-green-500/20 text-green-400' :
              t.status === 'queued' ? 'bg-yellow-500/20 text-yellow-400' :
              t.status === 'failed' ? 'bg-red-500/20 text-red-400' :
              'bg-slate-500/20 text-slate-400'
            }`}>{t.status}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">{t.serverName ?? t.serverId}</p>
        </div>
      ))}
    </div>
  );
}
