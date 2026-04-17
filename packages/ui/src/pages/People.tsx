import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTransport } from '../transport/TransportProvider.js';
import type { Person } from '../transport/types.js';

export default function People() {
  const transport = useTransport();
  const navigate = useNavigate();
  const [persons, setPersons] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    transport.getPersons()
      .then(setPersons)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };

  useEffect(load, [transport]);

  const active = persons.filter((p) => p.status === 'active');
  const archived = persons.filter((p) => p.status === 'archived');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="brand-kicker">人员管理</p>
          <h2 className="text-xl font-bold text-slate-100">人员列表</h2>
          <p className="mt-1 text-sm text-slate-500">共 {active.length} 名活跃人员</p>
        </div>
        <button onClick={() => navigate('/people/new')} className="rounded-xl bg-accent-blue px-4 py-2 text-sm text-white hover:bg-accent-blue/80">
          添加人员
        </button>
      </div>

      {loading ? (
        <div className="text-center text-sm text-slate-500 py-8">加载中...</div>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 border-b border-dark-border">
                <th className="text-left py-3 px-4">姓名</th>
                <th className="text-left py-3 px-4">邮箱</th>
                <th className="text-left py-3 px-4">QQ</th>
                <th className="text-left py-3 px-4">状态</th>
              </tr>
            </thead>
            <tbody>
              {active.map((p) => (
                <tr key={p.id} className="border-b border-dark-border/50 hover:bg-dark-hover cursor-pointer" onClick={() => navigate(`/people/${p.id}`)}>
                  <td className="py-3 px-4 text-slate-200">{p.displayName}</td>
                  <td className="py-3 px-4 text-slate-400">{p.email ?? '—'}</td>
                  <td className="py-3 px-4 text-slate-400">{p.qq ?? '—'}</td>
                  <td className="py-3 px-4 text-accent-green text-xs">活跃</td>
                </tr>
              ))}
              {archived.length > 0 && archived.map((p) => (
                <tr key={p.id} className="border-b border-dark-border/50 hover:bg-dark-hover cursor-pointer opacity-50" onClick={() => navigate(`/people/${p.id}`)}>
                  <td className="py-3 px-4 text-slate-400">{p.displayName}</td>
                  <td className="py-3 px-4 text-slate-500">{p.email ?? '—'}</td>
                  <td className="py-3 px-4 text-slate-500">{p.qq ?? '—'}</td>
                  <td className="py-3 px-4 text-slate-500 text-xs">已归档</td>
                </tr>
              ))}
              {persons.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">暂无人员</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
