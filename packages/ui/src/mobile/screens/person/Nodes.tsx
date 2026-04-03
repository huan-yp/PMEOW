import { useState, useEffect } from 'react';
import { getPersonMobileServers } from '../../api/person.js';
import { MobileEmptyState } from '../../components/MobileEmptyState.js';
import { MobilePageHeading } from '../../components/MobilePageHeading.js';
import { NodesIcon } from '../../components/MobileIcons.js';

export function PersonNodes() {
  const [servers, setServers] = useState<any[]>([]);

  useEffect(() => {
    void getPersonMobileServers().then(setServers).catch(() => setServers([]));
  }, []);

  if (servers.length === 0) {
    return (
      <MobileEmptyState
        icon={<NodesIcon className="h-6 w-6" />}
        title="暂无绑定节点"
        description="管理员分配的节点会在这里展示当前连通状态。"
      />
    );
  }

  return (
    <div className="space-y-4">
      <MobilePageHeading
        kicker="my nodes"
        title="我的节点"
        description="查看当前分配给你的节点和在线状态，保持与 Web 端一致的节点视图。"
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
