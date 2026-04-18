import { useState } from 'react';
import { useStore } from '../store/useStore.js';
import { useTransport } from '../transport/TransportProvider.js';

export default function Nodes() {
  const transport = useTransport();
  const servers = useStore((s) => s.servers);
  const isPerson = useStore((s) => s.principal?.kind === 'person');
  const addServer = useStore((s) => s.addServer);
  const removeServer = useStore((s) => s.removeServer);
  const statuses = useStore((s) => s.statuses);

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAgentId, setNewAgentId] = useState('');
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    if (!newName.trim() || !newAgentId.trim()) return;
    setAdding(true);
    try {
      const server = await transport.addServer({ name: newName.trim(), agentId: newAgentId.trim() });
      addServer(server);
      setNewName('');
      setNewAgentId('');
      setShowAdd(false);
    } catch { /* ignore */ }
    setAdding(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该节点?')) return;
    try {
      await transport.deleteServer(id);
      removeServer(id);
    } catch { /* ignore */ }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="brand-kicker">{isPerson ? '我的机器' : '节点管理'}</p>
          <h2 className="text-xl font-bold text-slate-100">{isPerson ? '机器列表' : '节点列表'}</h2>
        </div>
        {!isPerson && (
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="rounded-xl bg-accent-blue px-4 py-2 text-sm text-white hover:bg-accent-blue/80"
          >
            {showAdd ? '取消' : '添加节点'}
          </button>
        )}
      </div>

      {!isPerson && showAdd && (
        <div className="rounded-2xl border border-dark-border bg-dark-card p-4 space-y-3">
          <div>
            <label className="text-xs text-slate-400">名称</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="节点名称" className="mt-1 w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-slate-200 outline-none" />
          </div>
          <div>
            <label className="text-xs text-slate-400">Agent ID</label>
            <input value={newAgentId} onChange={(e) => setNewAgentId(e.target.value)} placeholder="Agent 唯一标识" className="mt-1 w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-slate-200 outline-none" />
          </div>
          <button onClick={handleAdd} disabled={adding} className="rounded-lg bg-accent-blue px-4 py-2 text-sm text-white hover:bg-accent-blue/80 disabled:opacity-50">
            {adding ? '添加中...' : '确认添加'}
          </button>
        </div>
      )}

      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 border-b border-dark-border">
              <th className="text-left py-3 px-4">名称</th>
              <th className="text-left py-3 px-4">Agent ID</th>
              <th className="text-left py-3 px-4">状态</th>
              {!isPerson && <th className="text-right py-3 px-4">操作</th>}
            </tr>
          </thead>
          <tbody>
            {servers.map((srv) => {
              const st = statuses.get(srv.id);
              return (
                <tr key={srv.id} className="border-b border-dark-border/50 hover:bg-dark-hover">
                  <td className="py-3 px-4 text-slate-200">{srv.name}</td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-400">{srv.agentId}</td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center gap-1.5 text-xs ${st?.status === 'online' ? 'text-accent-green' : 'text-slate-500'}`}>
                      <span className={`h-2 w-2 rounded-full ${st?.status === 'online' ? 'bg-accent-green' : 'bg-slate-600'}`} />
                      {st?.status === 'online' ? '在线' : '离线'}
                    </span>
                  </td>
                  {!isPerson && (
                    <td className="py-3 px-4 text-right">
                      <button onClick={() => handleDelete(srv.id)} className="text-xs text-accent-red hover:underline">删除</button>
                    </td>
                  )}
                </tr>
              );
            })}
            {servers.length === 0 && (
              <tr><td colSpan={isPerson ? 3 : 4} className="px-4 py-8 text-center text-slate-500">暂无节点</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
