import { useState, useEffect } from 'react';
import { getPersonMobileTasks, cancelPersonTask } from '../../api/person.js';
import { MobileEmptyState } from '../../components/MobileEmptyState.js';
import type { MirroredAgentTaskRecord } from '@monitor/core';

export function PersonTasks() {
  const [tasks, setTasks] = useState<MirroredAgentTaskRecord[]>([]);

  useEffect(() => {
    void getPersonMobileTasks().then(setTasks).catch(() => setTasks([]));
  }, []);

  const handleCancel = async (taskId: string) => {
    await cancelPersonTask(taskId);
    setTasks(prev => prev.map(t => t.taskId === taskId ? { ...t, status: 'cancelled' } : t));
  };

  if (tasks.length === 0) return <MobileEmptyState icon="📋" title="暂无任务" />;

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold text-slate-100">我的任务</h1>
      {tasks.map(t => (
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
          {(t.status === 'queued' || t.status === 'running') && (
            <button
              onClick={() => void handleCancel(t.taskId)}
              className="mt-2 text-xs text-red-400 hover:text-red-300"
            >
              取消任务
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
