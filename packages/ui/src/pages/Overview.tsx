import { useStore } from '../store/useStore.js';
import { GpuOverviewCard } from '../components/GpuOverviewCard.js';
import { ServerCard } from '../components/ServerCard.js';

export function Overview() {
  const { servers, statuses, latestMetrics } = useStore();

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">服务器概览</h1>
          <p className="text-sm text-slate-500 mt-1">
            共 {servers.length} 台服务器 · {
              Array.from(statuses.values()).filter(s => s.status === 'connected').length
            } 在线
          </p>
        </div>
        <div className="text-xs text-slate-600 font-mono">
          {new Date().toLocaleString('zh-CN')}
        </div>
      </div>

      <GpuOverviewCard />

      {servers.length === 0 ? (
        <div className="flex items-center justify-center h-64 border border-dashed border-dark-border rounded-xl">
          <div className="text-center">
            <p className="text-slate-500 text-lg mb-2">暂无服务器</p>
            <p className="text-slate-600 text-sm">前往「服务器管理」页面添加服务器</p>
          </div>
        </div>
      ) : (
        <div className={`grid gap-4 ${
          servers.length <= 2 ? 'grid-cols-1 md:grid-cols-2' :
          servers.length <= 4 ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-2' :
          'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
        }`}>
          {servers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              status={statuses.get(server.id)}
              metrics={latestMetrics.get(server.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
