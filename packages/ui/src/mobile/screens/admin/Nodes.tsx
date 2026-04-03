import { useState, useEffect } from 'react';
import { getAdminMobileServers } from '../../api/admin.js';
import { MobileEmptyState } from '../../components/MobileEmptyState.js';

export function AdminNodes() {
  const [servers, setServers] = useState<any[]>([]);

  useEffect(() => {
    void getAdminMobileServers().then(setServers).catch(() => setServers([]));
  }, []);

  if (servers.length === 0) return <MobileEmptyState icon="🖥️" title="暂无节点" />;

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold text-slate-100">节点列表</h1>
      {servers.map((s: any) => (
        <div key={s.id} className="rounded-xl border border-dark-border bg-dark-card p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-200">{s.name}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              s.status === 'connected' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
            }`}>{s.status === 'connected' ? '在线' : '离线'}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">{s.host}</p>
        </div>
      ))}
    </div>
  );
}
