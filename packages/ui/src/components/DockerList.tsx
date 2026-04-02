import type { DockerContainer } from '@monitor/core';

interface Props {
  containers: DockerContainer[];
}

const stateColor: Record<string, string> = {
  running: 'text-accent-green',
  exited: 'text-accent-red',
  paused: 'text-accent-yellow',
  created: 'text-slate-400',
  restarting: 'text-accent-yellow',
};

export function DockerList({ containers }: Props) {
  if (containers.length === 0) {
    return (
      <div className="text-center py-8 text-slate-600 text-sm">
        没有 Docker 容器或 Docker 未安装
      </div>
    );
  }

  return (
    <div className="overflow-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 border-b border-dark-border">
            <th className="text-left py-2 px-3">容器名</th>
            <th className="text-left py-2 px-3">镜像</th>
            <th className="text-left py-2 px-3">状态</th>
            <th className="text-left py-2 px-3">端口</th>
          </tr>
        </thead>
        <tbody>
          {containers.map((c) => (
            <tr key={c.id} className="border-b border-dark-border/50 hover:bg-dark-hover">
              <td className="py-1.5 px-3 text-slate-300 font-mono">{c.name}</td>
              <td className="py-1.5 px-3 text-slate-400 truncate max-w-[200px]">{c.image}</td>
              <td className={`py-1.5 px-3 ${stateColor[c.state] || 'text-slate-400'}`}>
                {c.status}
              </td>
              <td className="py-1.5 px-3 text-slate-500 truncate max-w-[200px]">{c.ports || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
