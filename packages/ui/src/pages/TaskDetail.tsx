import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTransport } from '../transport/TransportProvider.js';
import type { Task } from '../transport/types.js';

export default function TaskDetail() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const transport = useTransport();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!taskId) return;
    setLoading(true);
    transport.getTask(taskId)
      .then(setTask)
      .catch(() => setTask(null))
      .finally(() => setLoading(false));
  }, [taskId, transport]);

  if (loading) return <div className="p-8 text-center text-slate-500">加载中...</div>;
  if (!task) return <div className="p-8 text-center text-slate-500">任务不存在。<button onClick={() => navigate('/tasks')} className="ml-2 text-accent-blue hover:underline">返回列表</button></div>;

  const statusLabels: Record<string, string> = { queued: '排队中', running: '运行中', ended: '已结束' };

  return (
    <div className="space-y-6">
      <div>
        <button onClick={() => navigate('/tasks')} className="text-xs text-accent-blue hover:underline mb-2">← 返回任务列表</button>
        <h2 className="text-xl font-bold text-slate-100">任务详情</h2>
        <p className="mt-1 font-mono text-sm text-slate-400">{task.id}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <InfoCard label="命令" value={task.command} />
        <InfoCard label="工作目录" value={task.cwd} />
        <InfoCard label="用户" value={task.user} />
        <InfoCard label="状态" value={statusLabels[task.status] ?? task.status} />
        <InfoCard label="启动模式" value={task.launchMode} />
        <InfoCard label="优先级" value={String(task.priority)} />
        <InfoCard label="请求 VRAM" value={`${task.requireVramMb} MB × ${task.requireGpuCount} GPU`} />
        <InfoCard label="PID" value={task.pid ? String(task.pid) : '—'} />
        <InfoCard label="退出码" value={task.exitCode !== null ? String(task.exitCode) : '—'} />
        <InfoCard label="创建时间" value={new Date(task.createdAt * 1000).toLocaleString('zh-CN')} />
        <InfoCard label="开始时间" value={task.startedAt ? new Date(task.startedAt * 1000).toLocaleString('zh-CN') : '—'} />
        <InfoCard label="结束时间" value={task.finishedAt ? new Date(task.finishedAt * 1000).toLocaleString('zh-CN') : '—'} />
      </div>

      {task.assignedGpus && (
        <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
          <h3 className="mb-2 text-sm font-medium text-slate-300">分配的 GPU</h3>
          <p className="font-mono text-sm text-slate-200">{task.assignedGpus.join(', ')}</p>
          {task.declaredVramPerGpu && <p className="mt-1 text-xs text-slate-500">每 GPU 声明 {task.declaredVramPerGpu} MB VRAM</p>}
        </div>
      )}

      {task.scheduleHistory && task.scheduleHistory.length > 0 && (
        <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
          <h3 className="mb-3 text-sm font-medium text-slate-300">调度历史</h3>
          <div className="space-y-2">
            {task.scheduleHistory.map((entry, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg border border-dark-border/50 bg-dark-bg/50 p-3">
                <span className={`mt-0.5 inline-block h-2 w-2 rounded-full ${entry.result === 'scheduled' ? 'bg-accent-green' : 'bg-accent-yellow'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">{entry.result}</span>
                    <span className="text-slate-500">{new Date(entry.timestamp * 1000).toLocaleString('zh-CN')}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{entry.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {task.status !== 'ended' && (
        <div className="flex gap-3">
          <button
            onClick={async () => {
              try { await transport.cancelTask(task.serverId, task.id); navigate('/tasks'); } catch { /* ignore */ }
            }}
            className="rounded-lg bg-accent-red px-4 py-2 text-sm text-white hover:bg-accent-red/80"
          >
            取消任务
          </button>
        </div>
      )}
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-mono text-slate-200 break-all">{value}</p>
    </div>
  );
}
