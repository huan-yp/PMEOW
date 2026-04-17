import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTransport } from '../transport/TransportProvider.js';
import type { Person, PersonBinding, Task, PersonTimelinePoint } from '../transport/types.js';
import { TimeSeriesChart } from '../components/TimeSeriesChart.js';
import { formatVramGB } from '../utils/vram.js';

export default function PersonDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const transport = useTransport();

  const [person, setPerson] = useState<Person | null>(null);
  const [bindings, setBindings] = useState<PersonBinding[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [timeline, setTimeline] = useState<PersonTimelinePoint[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editQQ, setEditQQ] = useState('');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      transport.getPerson(id),
      transport.getPersonBindings(id),
      transport.getPersonTasks(id),
      transport.getPersonTimeline(id),
    ])
      .then(([p, b, t, tl]) => {
        setPerson(p);
        setBindings(b);
        setTasks(t.tasks);
        setTimeline(tl.points);
        setEditName(p.displayName);
        setEditEmail(p.email ?? '');
        setEditQQ(p.qq ?? '');
      })
      .catch(() => setPerson(null))
      .finally(() => setLoading(false));
  }, [id, transport]);

  const handleSave = async () => {
    if (!id) return;
    try {
      const updated = await transport.updatePerson(id, { displayName: editName, email: editEmail, qq: editQQ });
      setPerson(updated);
      setEditing(false);
    } catch { /* ignore */ }
  };

  if (loading) return <div className="p-8 text-center text-slate-500">加载中...</div>;
  if (!person) return <div className="p-8 text-center text-slate-500">人员不存在。<button onClick={() => navigate('/people')} className="ml-2 text-accent-blue hover:underline">返回列表</button></div>;

  const timelineSeries = [{
    name: 'VRAM',
    data: timeline.map((p) => ({ time: p.timestamp * 1000, value: p.vramMb })),
    color: '#8b5cf6',
    unit: ' MB',
  }];

  return (
    <div className="space-y-6">
      <div>
        <button onClick={() => navigate('/people')} className="text-xs text-accent-blue hover:underline mb-2">← 返回人员列表</button>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-100">{person.displayName}</h2>
          <button onClick={() => setEditing(!editing)} className="text-xs text-accent-blue hover:underline">
            {editing ? '取消编辑' : '编辑'}
          </button>
        </div>
        <p className="text-sm text-slate-500">{person.status === 'active' ? '活跃' : '已归档'}</p>
      </div>

      {editing && (
        <div className="rounded-2xl border border-dark-border bg-dark-card p-4 space-y-3">
          <div>
            <label className="text-xs text-slate-400">姓名</label>
            <input value={editName} onChange={(e) => setEditName(e.target.value)} className="mt-1 w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-slate-200 outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400">邮箱</label>
              <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-slate-200 outline-none" />
            </div>
            <div>
              <label className="text-xs text-slate-400">QQ</label>
              <input value={editQQ} onChange={(e) => setEditQQ(e.target.value)} className="mt-1 w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-slate-200 outline-none" />
            </div>
          </div>
          <button onClick={handleSave} className="rounded-lg bg-accent-blue px-4 py-2 text-sm text-white">保存</button>
        </div>
      )}

      {timeline.length > 0 && (
        <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
          <h3 className="mb-3 text-sm font-medium text-slate-300">VRAM 使用时间线</h3>
          <TimeSeriesChart series={timelineSeries} height={200} yAxisFormatter={(v) => formatVramGB(v)} />
        </div>
      )}

      <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
        <h3 className="mb-3 text-sm font-medium text-slate-300">账号绑定</h3>
        {bindings.length === 0 ? (
          <p className="text-sm text-slate-500">暂无绑定</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 border-b border-dark-border">
                <th className="text-left py-2 px-3">节点</th>
                <th className="text-left py-2 px-3">系统用户</th>
                <th className="text-left py-2 px-3">来源</th>
                <th className="text-left py-2 px-3">状态</th>
              </tr>
            </thead>
            <tbody>
              {bindings.map((b) => (
                <tr key={b.id} className="border-b border-dark-border/50">
                  <td className="py-2 px-3 text-slate-300">{b.serverId.slice(0, 8)}</td>
                  <td className="py-2 px-3 font-mono text-slate-200">{b.systemUser}</td>
                  <td className="py-2 px-3 text-slate-400">{b.source}</td>
                  <td className="py-2 px-3 text-xs">{b.enabled ? <span className="text-accent-green">启用</span> : <span className="text-slate-500">禁用</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
        <h3 className="mb-3 text-sm font-medium text-slate-300">任务记录</h3>
        {tasks.length === 0 ? (
          <p className="text-sm text-slate-500">暂无任务</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 border-b border-dark-border">
                <th className="text-left py-2 px-3">命令</th>
                <th className="text-left py-2 px-3">状态</th>
                <th className="text-left py-2 px-3">创建时间</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} className="border-b border-dark-border/50 hover:bg-dark-hover cursor-pointer" onClick={() => navigate(`/tasks/${t.id}`)}>
                  <td className="py-2 px-3 text-slate-200 truncate max-w-[200px]">{t.command}</td>
                  <td className="py-2 px-3 text-xs text-slate-400">{t.status}</td>
                  <td className="py-2 px-3 text-xs text-slate-500">{new Date(t.createdAt * 1000).toLocaleString('zh-CN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
