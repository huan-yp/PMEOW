import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTransport } from '../transport/TransportProvider.js';
import type { Task } from '../transport/types.js';
import { useStore } from '../store/useStore.js';

export function TaskBrowser({
  serverId,
  personId,
  hideServerColumn = false,
  emptyText = '无任务记录',
  pageSize = 20,
}: {
  serverId?: string;
  personId?: string;
  hideServerColumn?: boolean;
  emptyText?: string;
  pageSize?: number;
}) {
  const transport = useTransport();
  const navigate = useNavigate();
  const servers = useStore((state) => state.servers);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setPage(1);
  }, [personId, serverId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const request = personId
      ? transport.getPersonTasks(personId, { page, limit: pageSize })
      : transport.getTasks({ serverId, page, limit: pageSize, status: statusFilter || undefined });

    request
      .then((res) => {
        if (cancelled) return;
        setTasks(res.tasks);
        setTotal(res.total);
      })
      .catch(() => {
        if (cancelled) return;
        setTasks([]);
        setTotal(0);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [transport, personId, serverId, page, pageSize, statusFilter]);

  const totalPages = Math.ceil(total / pageSize);
  const colSpan = hideServerColumn ? 7 : 8;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">共 {total} 条任务</p>
        {!personId && (
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-dark-border bg-dark-card px-3 py-2 text-sm text-slate-200 outline-none"
          >
            <option value="">全部状态</option>
            <option value="queued">排队中</option>
            <option value="running">运行中</option>
            <option value="succeeded">已完成</option>
            <option value="failed">失败</option>
            <option value="cancelled">已取消</option>
            <option value="abnormal">异常结束</option>
          </select>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr className="text-slate-500 border-b border-dark-border">
              <th className="text-left py-3 px-3">ID</th>
              {!hideServerColumn && <th className="text-left py-3 px-3">机器</th>}
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
              <tr><td colSpan={colSpan} className="px-3 py-8 text-center text-slate-500">加载中...</td></tr>
            ) : tasks.length === 0 ? (
              <tr><td colSpan={colSpan} className="px-3 py-8 text-center text-slate-500">{emptyText}</td></tr>
            ) : tasks.map((task) => {
              const server = servers.find((item) => item.id === task.serverId);
              const serverName = server?.name ?? task.serverName ?? task.serverId;

              return (
                <tr key={task.id} className="border-b border-dark-border/50 hover:bg-dark-hover cursor-pointer" onClick={() => navigate(`/tasks/${task.id}`)}>
                  <td className="py-2.5 px-3 font-mono text-xs text-slate-400">{task.id.slice(0, 8)}</td>
                  {!hideServerColumn && (
                    <td className="py-2.5 px-3">
                      <div className="text-slate-200">{serverName}</div>
                      <div className="font-mono text-xs leading-5 text-slate-500 break-all">{task.serverId}</div>
                    </td>
                  )}
                  <td className="py-2.5 px-3 text-slate-200 max-w-[280px] whitespace-normal break-words leading-5" title={task.command}>{task.command}</td>
                  <td className="py-2.5 px-3 text-slate-300">{task.user}</td>
                  <td className="py-2.5 px-3">
                    <StatusBadge status={task.status} />
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-300">{task.priority}</td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-300">{task.requireVramMb} MB</td>
                  <td className="py-2.5 px-3 text-xs leading-5 text-slate-500 whitespace-nowrap">{new Date(task.createdAt * 1000).toLocaleString('zh-CN')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button disabled={page <= 1} onClick={() => setPage((current) => current - 1)} className="px-3 py-1 rounded border border-dark-border text-slate-400 hover:text-slate-200 disabled:opacity-30">上一页</button>
          <span className="text-slate-500">{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)} className="px-3 py-1 rounded border border-dark-border text-slate-400 hover:text-slate-200 disabled:opacity-30">下一页</button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    queued: 'bg-amber-500/20 text-amber-300',
    running: 'bg-blue-500/20 text-blue-300',
    succeeded: 'bg-emerald-500/20 text-emerald-300',
    failed: 'bg-red-500/20 text-red-300',
    cancelled: 'bg-slate-500/20 text-slate-400',
    abnormal: 'bg-orange-500/20 text-orange-300',
  };
  const labels: Record<string, string> = { queued: '排队中', running: '运行中', succeeded: '已完成', failed: '失败', cancelled: '已取消', abnormal: '异常结束' };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${styles[status] ?? 'bg-slate-500/20 text-slate-400'}`}>{labels[status] ?? status}</span>;
}