import { useState, useEffect } from 'react';
import { getPersonMobileTasks, cancelPersonTask } from '../../api/person.js';
import { MobileEmptyState } from '../../components/MobileEmptyState.js';
import { MobilePageHeading } from '../../components/MobilePageHeading.js';
import { TasksIcon } from '../../components/MobileIcons.js';
import type { MirroredAgentTaskRecord } from '@monitor/core';

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

export function PersonTasks() {
  const [tasks, setTasks] = useState<MirroredAgentTaskRecord[]>([]);

  useEffect(() => {
    void getPersonMobileTasks().then(setTasks).catch(() => setTasks([]));
  }, []);

  const handleCancel = async (taskId: string) => {
    await cancelPersonTask(taskId);
    setTasks(prev => prev.map(t => t.taskId === taskId ? { ...t, status: 'cancelled' } : t));
  };

  if (tasks.length === 0) {
    return (
      <MobileEmptyState
        icon={<TasksIcon className="h-6 w-6" />}
        title="暂无任务"
        description="你提交的排队和运行任务会显示在这里。"
      />
    );
  }

  return (
    <div className="space-y-4">
      <MobilePageHeading
        kicker="my tasks"
        title="我的任务"
        description="随时查看自己的任务状态，并在移动端快速终止排队或运行中的任务。"
      />
      {tasks.map(t => (
        <div key={t.taskId} className="brand-card rounded-[24px] p-4">
          <div className="flex items-center justify-between">
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-100">{t.command || t.taskId}</span>
            <span className={`ml-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${getTaskStatusClassName(t.status)}`}>
              {t.status}
            </span>
          </div>
          {(t.status === 'queued' || t.status === 'running') && (
            <button
              type="button"
              onClick={() => void handleCancel(t.taskId)}
              className="mt-4 inline-flex rounded-full border border-accent-red/20 bg-accent-red/10 px-3 py-1.5 text-xs font-medium text-accent-red transition-colors hover:border-accent-red/35 hover:bg-accent-red/15"
            >
              取消任务
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
