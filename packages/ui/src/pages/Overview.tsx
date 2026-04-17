import { useStore } from '../store/useStore.js';
import { ServerCard } from '../components/ServerCard.js';

export default function Overview() {
  const servers = useStore((s) => s.servers);
  const statuses = useStore((s) => s.statuses);
  const latestSnapshots = useStore((s) => s.latestSnapshots);

  const onlineCount = [...statuses.values()].filter((s) => s.status === 'online').length;

  return (
    <div className="space-y-6">
      <div>
        <p className="brand-kicker">控制台</p>
        <h2 className="text-xl font-bold text-slate-100">节点运行视图</h2>
        <p className="mt-1 text-sm text-slate-500">
          共 {servers.length} 台节点，{onlineCount} 台在线
        </p>
      </div>

      {servers.length === 0 ? (
        <div className="rounded-2xl border border-dark-border bg-dark-card p-12 text-center">
          <p className="text-slate-400">暂无节点，请先在「节点管理」中添加。</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {servers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              status={statuses.get(server.id)}
              report={latestSnapshots.get(server.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
