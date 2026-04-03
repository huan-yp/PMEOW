import type { ProcessAuditRow } from '@monitor/core';
import { formatMemoryKilobytesGB, formatVramGB } from '../utils/vram.js';

interface Props {
  processes: ProcessAuditRow[];
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
            <th className="text-right py-2 px-3">RSS GB</th>
            <th className="text-right py-2 px-3">VRAM GB</th>
            <th className="text-left py-2 px-3">风险</th>
            <th className="text-left py-2 px-3">命令</th>
          </tr>
        </thead>
        <tbody>
          {processes.map((p) => (
            <tr key={p.pid} className={`border-b border-dark-border/50 hover:bg-dark-hover ${p.suspiciousReasons.length > 0 ? 'bg-accent-red/5' : ''}`}>
              <td className="py-1.5 px-3 font-mono text-slate-400">{p.pid}</td>
              <td className="py-1.5 px-3 text-slate-300">{p.user}</td>
              <td className={`py-1.5 px-3 text-right font-mono ${p.cpuPercent > 50 ? 'text-accent-red' : p.cpuPercent > 20 ? 'text-accent-yellow' : 'text-slate-300'}`}>
                {p.cpuPercent.toFixed(1)}
              </td>
              <td className={`py-1.5 px-3 text-right font-mono ${p.memPercent > 50 ? 'text-accent-red' : 'text-slate-300'}`}>
                {p.memPercent.toFixed(1)}
              </td>
              <td className="py-1.5 px-3 text-right font-mono text-slate-400">
                {formatMemoryKilobytesGB(p.rss)}
              </td>
              <td className={`py-1.5 px-3 text-right font-mono ${p.gpuMemoryMB > 0 ? 'text-accent-blue' : 'text-slate-500'}`}>
                {formatVramGB(p.gpuMemoryMB)}
              </td>
              <td className={`py-1.5 px-3 ${p.suspiciousReasons.length > 0 ? 'text-accent-red' : 'text-slate-500'}`}>
                {p.suspiciousReasons.length > 0 ? p.suspiciousReasons.join('；') : '正常'}
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
