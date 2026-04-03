import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTransport } from '../transport/TransportProvider.js';
import type { PersonRecord, PersonSummaryItem } from '@monitor/core';
import { formatVramGB } from '../utils/vram.js';

type PersonDirectoryRow = Pick<PersonRecord, 'id' | 'displayName' | 'email' | 'qq' | 'note'> & {
  currentVramMB: number;
  runningTaskCount: number;
  queuedTaskCount: number;
  activeServerCount: number;
};

function mergePersonDirectory(persons: PersonRecord[], summary: PersonSummaryItem[]): PersonDirectoryRow[] {
  const summaryByPersonId = new Map(summary.map((row) => [row.personId, row]));

  return persons.map((person) => {
    const summaryRow = summaryByPersonId.get(person.id);

    return {
      id: person.id,
      displayName: person.displayName,
      email: person.email,
      qq: person.qq,
      note: person.note,
      currentVramMB: summaryRow?.currentVramMB ?? 0,
      runningTaskCount: summaryRow?.runningTaskCount ?? 0,
      queuedTaskCount: summaryRow?.queuedTaskCount ?? 0,
      activeServerCount: summaryRow?.activeServerCount ?? 0,
    };
  });
}

function PeopleOverviewLoadingState() {
  return (
    <div className="space-y-4" role="status" aria-label="人员加载中">
      <div className="rounded-2xl border border-dark-border bg-dark-card/50 px-4 py-3 text-sm text-slate-500">
        正在加载人员目录...
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_value, index) => (
          <div key={index} className="rounded-2xl border border-dark-border bg-dark-card p-5">
            <div className="h-6 w-28 animate-pulse rounded bg-dark-bg/80" />
            <div className="mt-3 h-4 w-44 animate-pulse rounded bg-dark-bg/70" />
            <div className="mt-6 space-y-2">
              <div className="h-4 w-32 animate-pulse rounded bg-dark-bg/70" />
              <div className="h-4 w-36 animate-pulse rounded bg-dark-bg/70" />
              <div className="h-3 w-24 animate-pulse rounded bg-dark-bg/60" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PeopleOverview() {
  const transport = useTransport();
  const [rows, setRows] = useState<PersonDirectoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);

      try {
        const [personsResult, summaryResult] = await Promise.allSettled([transport.getPersons(), transport.getPersonSummary()]);

        if (!cancelled) {
          const persons = personsResult.status === 'fulfilled' ? personsResult.value : [];
          const summary = summaryResult.status === 'fulfilled' ? summaryResult.value : [];
          setRows(mergePersonDirectory(persons, summary));
        }
      } catch {
        if (!cancelled) {
          setRows([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [transport]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="brand-kicker">PEOPLE</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-100">人员</h1>
        </div>
        <Link
          to="/people/new"
          className="inline-flex items-center justify-center rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-blue/80"
        >
          添加人员
        </Link>
      </div>
      {loading ? (
        <PeopleOverviewLoadingState />
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
          {rows.map((row) => (
            <Link key={row.id} to={`/people/${row.id}`} className="block rounded-2xl border border-dark-border bg-dark-card p-5 transition-colors hover:border-accent-blue/30">
              <p className="text-lg text-slate-100">{row.displayName}</p>
              <p className="mt-2 text-sm text-slate-500">{[row.email, row.qq].filter(Boolean).join(' · ') || row.note || '未填写联系信息'}</p>
              <div className="mt-4 space-y-1">
                <p className="mt-2 text-sm text-slate-400">当前显存 {formatVramGB(row.currentVramMB)}</p>
                <p className="mt-1 text-sm text-slate-400">运行 {row.runningTaskCount} · 排队 {row.queuedTaskCount}</p>
                <p className="mt-1 text-xs text-slate-500">活跃节点 {row.activeServerCount}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
