import { useState, useEffect } from 'react';
import { getAdminMobileTasks } from '../../api/admin.js';
import { MobileEmptyState } from '../../components/MobileEmptyState.js';
import { TasksIcon } from '../../components/MobileIcons.js';
import { MobilePageHeading } from '../../components/MobilePageHeading.js';

function getTaskStatusClassName(status: string) {
  switch (status) {
    case 'running':
      return 'border border-emerald-400/20 bg-emerald-500/12 text-emerald-300';
    case 'queued':
      return 'border border-amber-400/20 bg-amber-500/12 text-amber-200';
    case 'failed':
      return 'border border-rose-400/20 bg-rose-500/12 text-rose-200';
    default:
      return 'border border-slate-400/15 bg-slate-500/12 text-slate-300';
  }
}

export function AdminTasks() {
  const [tasks, setTasks] = useState<any[]>([]);

  useEffect(() => {
    void getAdminMobileTasks().then(setTasks).catch(() => setTasks([]));
  }, []);

  if (tasks.length === 0) {
    return (
      <MobileEmptyState
        icon={<TasksIcon className="h-6 w-6" />}
        title="暂无任务"
        description="新提交或正在排队的任务会显示在这里。"
      />
    );
  }

  return (
    <div className="space-y-4">
      <MobilePageHeading
        kicker="task queue"
        title="任务列表"
        description="集中查看当前排队、运行和近期变化的任务状态。"
      />
      {tasks.map((t: any) => (
        <div key={t.taskId} className="brand-card rounded-[24px] p-4">
          <div className="flex items-center justify-between">
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-100">{t.command || t.taskId}</span>
            <span className={`ml-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${getTaskStatusClassName(t.status)}`}>
              {t.status}
            </span>
          </div>
          <p className="mt-3 text-xs text-slate-500">{t.serverName ?? t.serverId}</p>
        </div>
      ))}
    </div>
  );
}
