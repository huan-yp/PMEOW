import type { ProcessInfo } from '@monitor/core';

interface Props {
  processes: ProcessInfo[];
}

export function ProcessTable({ processes }: Props) {
  return (
    <div className="overflow-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 border-b border-dark-border">
            <th className="text-left py-2 px-3">PID</th>
            <th className="text-left py-2 px-3">用户</th>
            <th className="text-right py-2 px-3">CPU%</th>
            <th className="text-right py-2 px-3">MEM%</th>
            <th className="text-right py-2 px-3">RSS</th>
            <th className="text-left py-2 px-3">命令</th>
          </tr>
        </thead>
        <tbody>
          {processes.map((p) => (
            <tr key={p.pid} className="border-b border-dark-border/50 hover:bg-dark-hover">
              <td className="py-1.5 px-3 font-mono text-slate-400">{p.pid}</td>
              <td className="py-1.5 px-3 text-slate-300">{p.user}</td>
              <td className={`py-1.5 px-3 text-right font-mono ${p.cpuPercent > 50 ? 'text-accent-red' : p.cpuPercent > 20 ? 'text-accent-yellow' : 'text-slate-300'}`}>
                {p.cpuPercent.toFixed(1)}
              </td>
              <td className={`py-1.5 px-3 text-right font-mono ${p.memPercent > 50 ? 'text-accent-red' : 'text-slate-300'}`}>
                {p.memPercent.toFixed(1)}
              </td>
              <td className="py-1.5 px-3 text-right font-mono text-slate-400">
                {(p.rss / 1024).toFixed(0)}M
              </td>
              <td className="py-1.5 px-3 text-slate-400 truncate max-w-[300px]" title={p.command}>
                {p.command}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
