import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTransport } from '../transport/TransportProvider.js';
import type { PersonDirectoryItem } from '../transport/types.js';
import { formatMemoryGB, formatVramGB } from '../utils/vram.js';

type SortField = 'cpu' | 'memory' | 'vram';
type SortDir = 'desc' | 'asc';

function PeopleLoadingState() {
  return (
    <div className="space-y-4" role="status" aria-label="人员加载中">
      <div className="rounded-2xl border border-dark-border bg-dark-card/50 px-4 py-3 text-sm text-slate-500">
        正在加载人员目录...
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_value, index) => (
          <div key={index} className="rounded-2xl border border-dark-border bg-dark-card p-5">
            <div className="h-6 w-28 animate-pulse rounded bg-dark-bg/80" />
            <div className="mt-3 h-4 w-44 animate-pulse rounded bg-dark-bg/70" />
            <div className="mt-6 space-y-2">
              <div className="h-4 w-32 animate-pulse rounded bg-dark-bg/70" />
              <div className="h-4 w-36 animate-pulse rounded bg-dark-bg/70" />
              <div className="h-3 w-24 animate-pulse rounded bg-dark-bg/60" />
              <div className="h-3 w-28 animate-pulse rounded bg-dark-bg/60" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatContactLine(row: PersonDirectoryItem): string {
  return [row.email, row.qq].filter(Boolean).join(' · ') || row.note || '未填写联系信息';
}

const SORT_LABELS: Record<SortField, string> = {
  cpu: 'CPU 占用',
  memory: '内存占用',
  vram: '显存占用',
};

function getSortValue(row: PersonDirectoryItem, sortField: SortField): number {
  if (sortField === 'memory') {
    return row.currentMemoryMb;
  }

  if (sortField === 'vram') {
    return row.currentVramMb;
  }

  return row.currentCpuPercent;
}

export default function People() {
  const transport = useTransport();
  const [rows, setRows] = useState<PersonDirectoryItem[] | null>(null);
  const [sortField, setSortField] = useState<SortField>('cpu');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const nextRows = await transport.getPersonDirectory();
        if (!cancelled) {
          setRows(nextRows);
        }
      } catch {
        if (!cancelled) {
          setRows([]);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [transport]);

  const activeCount = rows?.filter((row) => row.status === 'active').length ?? 0;
  const archivedCount = rows?.filter((row) => row.status === 'archived').length ?? 0;
  const sortedRows = [...(rows ?? [])].sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === 'active' ? -1 : 1;
    }

    const leftValue = getSortValue(left, sortField);
    const rightValue = getSortValue(right, sortField);
    if (leftValue !== rightValue) {
      return sortDir === 'desc' ? rightValue - leftValue : leftValue - rightValue;
    }

    return left.displayName.localeCompare(right.displayName, 'zh-CN');
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="brand-kicker">PEOPLE</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-100">人员</h1>
          <p className="mt-2 text-sm text-slate-500">共 {rows?.length ?? 0} 人，活跃 {activeCount}，归档 {archivedCount}。当前按 {SORT_LABELS[sortField]}{sortDir === 'desc' ? '降序' : '升序'}排序。</p>
        </div>
        <Link to="/people/new" className="inline-flex items-center justify-center rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-blue/80">
          添加人员
        </Link>
      </div>

      {rows !== null && rows.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>排序</span>
          <select
            value={sortField}
            onChange={(event) => setSortField(event.target.value as SortField)}
            className="rounded-full border border-dark-border bg-dark-card px-3 py-1.5 text-xs text-slate-200 outline-none"
          >
            <option value="cpu">CPU 占用</option>
            <option value="memory">内存占用</option>
            <option value="vram">显存占用</option>
          </select>
          <button
            type="button"
            onClick={() => setSortDir((direction) => direction === 'desc' ? 'asc' : 'desc')}
            className="rounded-full border border-dark-border bg-dark-card px-3 py-1.5 text-xs text-slate-300 hover:text-slate-100"
          >
            {sortDir === 'desc' ? '降序' : '升序'}
          </button>
          <span className="ml-auto text-slate-500">共 {rows.length} 条</span>
        </div>
      )}

      {rows === null ? (
        <PeopleLoadingState />
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-dark-border bg-dark-card/50 p-8 text-center">
          <p className="text-lg font-medium text-slate-100">还没有人员</p>
          <p className="mt-2 text-sm text-slate-400">先添加第一位人员，再继续查看归属与任务情况。</p>
          <Link
            to="/people/new"
            className="mt-5 inline-flex items-center justify-center rounded-lg border border-accent-blue/30 bg-accent-blue/10 px-4 py-2 text-sm font-medium text-accent-blue transition-colors hover:border-accent-blue/50 hover:bg-accent-blue/15"
          >
            开始添加
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sortedRows.map((row) => (
            <Link
              key={row.id}
              to={`/people/${row.id}`}
              className={`block rounded-2xl border bg-dark-card p-5 transition-colors hover:border-accent-blue/30 ${row.status === 'archived' ? 'border-dark-border/70 opacity-70' : 'border-dark-border'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg text-slate-100">{row.displayName}</p>
                  <p className="mt-2 text-sm text-slate-500">{formatContactLine(row)}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs ${row.status === 'archived' ? 'bg-slate-800 text-slate-400' : 'bg-emerald-500/10 text-emerald-300'}`}>
                  {row.status === 'archived' ? '已归档' : '活跃'}
                </span>
              </div>

              <div className="mt-4 space-y-1">
                <p className="text-sm text-slate-400">CPU {row.currentCpuPercent.toFixed(1)}% · 内存 {formatMemoryGB(row.currentMemoryMb)}</p>
                <p className="text-sm text-slate-400">当前显存 {formatVramGB(row.currentVramMb)}</p>
                <p className="text-sm text-slate-400">运行 {row.runningTaskCount} · 排队 {row.queuedTaskCount}</p>
                <p className="text-xs text-slate-500">活跃节点 {row.activeServerCount}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
