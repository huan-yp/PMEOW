import { useState, useEffect } from 'react';
import { getAdminMobileServers } from '../../api/admin.js';
import { MobileEmptyState } from '../../components/MobileEmptyState.js';
import { MobilePageHeading } from '../../components/MobilePageHeading.js';
import { NodesIcon } from '../../components/MobileIcons.js';

export function AdminNodes() {
  const [servers, setServers] = useState<any[]>([]);

  useEffect(() => {
    void getAdminMobileServers().then(setServers).catch(() => setServers([]));
  }, []);

  if (servers.length === 0) {
    return (
      <MobileEmptyState
        icon={<NodesIcon className="h-6 w-6" />}
        title="暂无节点"
        description="节点接入后会在这里显示在线状态和主机地址。"
      />
    );
  }

  return (
    <div className="space-y-4">
      <MobilePageHeading
        kicker="node catalog"
        title="节点列表"
        description="随时查看节点连通性和主机信息，维持与 Web 端一致的节点目录感知。"
      />
      {servers.map((s: any) => (
        <div key={s.id} className="brand-card rounded-[24px] p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-100">{s.name}</span>
            <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              s.status === 'connected'
                ? 'border border-emerald-400/20 bg-emerald-500/12 text-emerald-300'
                : 'border border-rose-400/20 bg-rose-500/12 text-rose-200'
            }`}>{s.status === 'connected' ? '在线' : '离线'}</span>
          </div>
          <p className="mt-3 text-xs text-slate-500">{s.host}</p>
        </div>
      ))}
    </div>
  );
}
