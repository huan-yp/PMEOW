import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTransport } from '../transport/TransportProvider.js';
import type { Task } from '../transport/types.js';

export default function Tasks() {
  const transport = useTransport();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const limit = 20;

  useEffect(() => {
    setLoading(true);
    transport.getTasks({ page, limit, status: statusFilter || undefined })
      .then((res) => { setTasks(res.tasks); setTotal(res.total); })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [transport, page, statusFilter]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div>
        <p className="brand-kicker">任务调度</p>
        <h2 className="text-xl font-bold text-slate-100">任务列表</h2>
        <p className="mt-1 text-sm text-slate-500">共 {total} 条任务</p>
      </div>

      <div className="flex items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-dark-border bg-dark-card px-3 py-2 text-sm text-slate-200 outline-none"
        >
          <option value="">全部状态</option>
          <option value="queued">排队中</option>
          <option value="running">运行中</option>
          <option value="ended">已结束</option>
        </select>
      </div>

      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 border-b border-dark-border">
              <th className="text-left py-3 px-3">ID</th>
              <th className="text-left py-3 px-3">命令</th>
              <th className="text-left py-3 px-3">用户</th>
              <th className="text-left py-3 px-3">状态</th>
              <th className="text-right py-3 px-3">优先级</th>
              <th className="text-right py-3 px-3">VRAM</th>
              <th className="text-left py-3 px-3">创建时间</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">加载中...</td></tr>
            ) : tasks.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">无任务记录</td></tr>
            ) : tasks.map((task) => (
              <tr key={task.id} className="border-b border-dark-border/50 hover:bg-dark-hover cursor-pointer" onClick={() => navigate(`/tasks/${task.id}`)}>
                <td className="py-2.5 px-3 font-mono text-xs text-slate-400">{task.id.slice(0, 8)}</td>
                <td className="py-2.5 px-3 text-slate-200 truncate max-w-[200px]" title={task.command}>{task.command}</td>
                <td className="py-2.5 px-3 text-slate-300">{task.user}</td>
                <td className="py-2.5 px-3">
                  <StatusBadge status={task.status} />
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-slate-300">{task.priority}</td>
                <td className="py-2.5 px-3 text-right font-mono text-slate-300">{task.requireVramMb} MB</td>
                <td className="py-2.5 px-3 text-xs text-slate-500">{new Date(task.createdAt * 1000).toLocaleString('zh-CN')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1 rounded border border-dark-border text-slate-400 hover:text-slate-200 disabled:opacity-30">上一页</button>
          <span className="text-slate-500">{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="px-3 py-1 rounded border border-dark-border text-slate-400 hover:text-slate-200 disabled:opacity-30">下一页</button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    queued: 'bg-amber-500/20 text-amber-300',
    running: 'bg-blue-500/20 text-blue-300',
    ended: 'bg-slate-500/20 text-slate-400',
  };
  const labels: Record<string, string> = { queued: '排队中', running: '运行中', ended: '已结束' };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${styles[status] ?? styles.ended}`}>{labels[status] ?? status}</span>;
}
