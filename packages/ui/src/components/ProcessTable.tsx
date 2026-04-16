import { useState } from 'react';
import type { ProcessAuditRow } from '@monitor/core';
import { formatMemoryKilobytesGB, formatVramGB } from '../utils/vram.js';

interface Props {
  processes: ProcessAuditRow[];
}

type ProcessSortField = 'cpuPercent' | 'memPercent' | 'rss' | 'gpuMemoryMB' | 'gpuUtilPercent';
type SortDirection = 'desc' | 'asc';

const SORT_OPTIONS: Array<{ value: ProcessSortField; label: string }> = [
  { value: 'cpuPercent', label: 'CPU 占用' },
  { value: 'memPercent', label: '内存占用' },
  { value: 'rss', label: 'RSS' },
  { value: 'gpuMemoryMB', label: 'VRAM' },
  { value: 'gpuUtilPercent', label: 'GPU 占用' },
];

function compareMetric(
  left: number | undefined,
  right: number | undefined,
  direction: SortDirection,
): number {
  const leftMissing = left === undefined;
  const rightMissing = right === undefined;

  if (leftMissing || rightMissing) {
    if (leftMissing && rightMissing) {
      return 0;
    }
    if (direction === 'desc') {
      return leftMissing ? 1 : -1;
    }
    return leftMissing ? -1 : 1;
  }

  return direction === 'desc' ? right - left : left - right;
}

function formatGpuUtilPercent(value: number | undefined): string {
  if (value === undefined) {
    return 'N/A';
  }

  return `${value.toFixed(1)}%`;
}

export function ProcessTable({ processes }: Props) {
  const [sortField, setSortField] = useState<ProcessSortField>('cpuPercent');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [gpuOnly, setGpuOnly] = useState(false);
  const [suspiciousOnly, setSuspiciousOnly] = useState(false);
  const [boundOnly, setBoundOnly] = useState(false);

  const visibleProcesses = processes
    .filter((process) => {
      if (gpuOnly && process.gpuMemoryMB <= 0 && process.gpuUtilPercent === undefined) {
        return false;
      }
      if (suspiciousOnly && process.suspiciousReasons.length === 0) {
        return false;
      }
      if (boundOnly && !process.resolvedPersonId && !process.resolvedPersonName) {
        return false;
      }
      return true;
    })
    .slice()
    .sort((left, right) => {
      const byMetric = compareMetric(left[sortField], right[sortField], sortDirection);
      if (byMetric !== 0) {
        return byMetric;
      }

      if (left.pid !== right.pid) {
        return sortDirection === 'desc' ? right.pid - left.pid : left.pid - right.pid;
      }

      return left.command.localeCompare(right.command, 'zh-CN');
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-dark-border/80 bg-dark-bg/30 p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <span>排序</span>
            <select
              value={sortField}
              onChange={(event) => setSortField(event.target.value as ProcessSortField)}
              className="rounded-full border border-dark-border bg-dark-card px-3 py-1.5 text-xs text-slate-200 outline-none"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setSortDirection((current) => current === 'desc' ? 'asc' : 'desc')}
            className="rounded-full border border-dark-border bg-dark-card px-3 py-1.5 text-xs text-slate-300 transition-colors hover:text-slate-100"
          >
            {sortDirection === 'desc' ? '降序' : '升序'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setGpuOnly((current) => !current)}
            className={`rounded-full px-3 py-1.5 text-xs transition-colors ${gpuOnly ? 'bg-accent-blue text-white' : 'border border-dark-border bg-dark-card text-slate-300 hover:text-slate-100'}`}
          >
            仅 GPU 进程
          </button>
          <button
            type="button"
            onClick={() => setSuspiciousOnly((current) => !current)}
            className={`rounded-full px-3 py-1.5 text-xs transition-colors ${suspiciousOnly ? 'bg-accent-red text-white' : 'border border-dark-border bg-dark-card text-slate-300 hover:text-slate-100'}`}
          >
            仅风险进程
          </button>
          <button
            type="button"
            onClick={() => setBoundOnly((current) => !current)}
            className={`rounded-full px-3 py-1.5 text-xs transition-colors ${boundOnly ? 'bg-emerald-500 text-white' : 'border border-dark-border bg-dark-card text-slate-300 hover:text-slate-100'}`}
          >
            仅已绑定人员
          </button>
        </div>

        <div className="text-xs text-slate-500">
          共 {visibleProcesses.length} / {processes.length} 条
        </div>
      </div>

      <div className="overflow-auto">
        <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 border-b border-dark-border">
            <th className="text-left py-2 px-3">PID</th>
            <th className="text-left py-2 px-3">用户</th>
            <th className="text-left py-2 px-3">人员</th>
            <th className="text-right py-2 px-3">CPU%</th>
            <th className="text-right py-2 px-3">MEM%</th>
            <th className="text-right py-2 px-3">RSS GB</th>
            <th className="text-right py-2 px-3">VRAM GB</th>
            <th className="text-right py-2 px-3">GPU%</th>
            <th className="text-left py-2 px-3">风险</th>
            <th className="text-left py-2 px-3">命令</th>
          </tr>
        </thead>
        <tbody>
          {visibleProcesses.map((p, index) => (
            <tr key={`${p.pid}-${p.command}-${index}`} className={`border-b border-dark-border/50 hover:bg-dark-hover ${p.suspiciousReasons.length > 0 ? 'bg-accent-red/5' : ''}`}>
              <td className="py-1.5 px-3 font-mono text-slate-400">{p.pid}</td>
              <td className="py-1.5 px-3 text-slate-300">{p.user}</td>
              <td className="py-1.5 px-3 text-slate-300">{p.resolvedPersonName || p.user || '未知'}</td>
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
              <td className={`py-1.5 px-3 text-right font-mono ${p.gpuUtilPercent !== undefined ? 'text-accent-yellow' : 'text-slate-500'}`}>
                {formatGpuUtilPercent(p.gpuUtilPercent)}
              </td>
              <td className={`py-1.5 px-3 ${p.suspiciousReasons.length > 0 ? 'text-accent-red' : 'text-slate-500'}`}>
                {p.suspiciousReasons.length > 0 ? p.suspiciousReasons.join('；') : '正常'}
              </td>
              <td className="py-1.5 px-3 text-slate-400 truncate max-w-[300px]" title={p.command}>
                {p.command}
              </td>
            </tr>
          ))}
          {visibleProcesses.length === 0 && (
            <tr>
              <td colSpan={10} className="px-3 py-8 text-center text-sm text-slate-500">
                当前筛选条件下没有进程记录
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div>
    </div>
  );
}
