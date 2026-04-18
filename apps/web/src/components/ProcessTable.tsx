import { useState } from 'react';
import type { ProcessInfo } from '../transport/types.js';

interface Props {
  processes: ProcessInfo[];
}

type SortField = 'cpuPercent' | 'memoryMb';
type SortDir = 'desc' | 'asc';

export function ProcessTable({ processes }: Props) {
  const [sortField, setSortField] = useState<SortField>('cpuPercent');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const sorted = [...processes].sort((a, b) => {
    const av = sortField === 'memoryMb' ? a.rss : a.cpuPercent;
    const bv = sortField === 'memoryMb' ? b.rss : b.cpuPercent;
    return sortDir === 'desc' ? bv - av : av - bv;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span>排序</span>
        <select
          value={sortField}
          onChange={(e) => setSortField(e.target.value as SortField)}
          className="rounded-full border border-dark-border bg-dark-card px-3 py-1.5 text-xs text-slate-200 outline-none"
        >
          <option value="cpuPercent">CPU 占用</option>
          <option value="memoryMb">内存占用</option>
        </select>
        <button
          type="button"
          onClick={() => setSortDir((d) => d === 'desc' ? 'asc' : 'desc')}
          className="rounded-full border border-dark-border bg-dark-card px-3 py-1.5 text-xs text-slate-300 hover:text-slate-100"
        >
          {sortDir === 'desc' ? '降序' : '升序'}
        </button>
        <span className="ml-auto text-slate-500">共 {processes.length} 条</span>
      </div>

      <div className="overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-dark-border">
              <th className="text-left py-2 px-3">PID</th>
              <th className="text-left py-2 px-3">用户</th>
              <th className="text-right py-2 px-3">CPU%</th>
              <th className="text-right py-2 px-3">RSS MB</th>
              <th className="text-right py-2 px-3">GPU MB</th>
              <th className="text-left py-2 px-3">命令</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => (
              <tr key={`${p.pid}-${i}`} className="border-b border-dark-border/50 hover:bg-dark-hover">
                <td className="py-1.5 px-3 font-mono text-slate-400">{p.pid}</td>
                <td className="py-1.5 px-3 text-slate-300">{p.user}</td>
                <td className={`py-1.5 px-3 text-right font-mono ${p.cpuPercent > 50 ? 'text-accent-red' : p.cpuPercent > 20 ? 'text-accent-yellow' : 'text-slate-300'}`}>
                  {p.cpuPercent.toFixed(1)}
                </td>
                <td className="py-1.5 px-3 text-right font-mono text-slate-300">{(p.rss / (1024 * 1024)).toFixed(0)}</td>
                <td className="py-1.5 px-3 text-right font-mono text-slate-300">{p.gpuMemoryMb.toFixed(0)}</td>
                <td className="py-1.5 px-3 text-slate-400 truncate max-w-[300px]" title={p.command}>{p.command}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-500">无进程数据</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
