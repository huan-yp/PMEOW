import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTransport } from '../transport/TransportProvider.js';
import type { PersonRecord, PersonSummaryItem } from '@monitor/core';
import { formatVramGB } from '../utils/vram.js';

type PeopleFilter = 'active' | 'all';

type PersonDirectoryRow = Pick<PersonRecord, 'id' | 'displayName' | 'email' | 'qq' | 'note'> & {
  currentVramMB: number;
  runningTaskCount: number;
  queuedTaskCount: number;
  activeServerCount: number;
};

function isPersonActive(row: PersonDirectoryRow): boolean {
  return row.currentVramMB > 0 || row.runningTaskCount > 0 || row.queuedTaskCount > 0 || row.activeServerCount > 0;
}

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

function PersonSummaryLoadingState() {
  return (
    <div className="mt-4 space-y-2">
      <p className="text-xs text-slate-500">统计加载中...</p>
      <div className="h-4 w-32 animate-pulse rounded bg-dark-bg/70" />
      <div className="h-4 w-36 animate-pulse rounded bg-dark-bg/70" />
      <div className="h-3 w-24 animate-pulse rounded bg-dark-bg/60" />
    </div>
  );
}

export function PeopleOverview() {
  const transport = useTransport();
  const [persons, setPersons] = useState<PersonRecord[] | null>(null);
  const [summary, setSummary] = useState<PersonSummaryItem[] | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [filter, setFilter] = useState<PeopleFilter>('active');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setPersons(null);
      setSummary(null);
      setSummaryLoading(false);

      try {
        const nextPersons = await transport.getPersons();

        if (!cancelled) {
          setPersons(nextPersons);
        }

        if (cancelled || nextPersons.length === 0) {
          return;
        }

        // The aggregate summary query is heavier than the directory list. Fetch it after
        // the base list so the page becomes usable as soon as possible.
        setSummaryLoading(true);

        try {
          const nextSummary = await transport.getPersonSummary();
          if (!cancelled) {
            setSummary(nextSummary);
          }
        } catch {
          if (!cancelled) {
            setSummary([]);
          }
        } finally {
          if (!cancelled) {
            setSummaryLoading(false);
          }
        }
      } catch {
        if (!cancelled) {
          setPersons([]);
          setSummary([]);
          setSummaryLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [transport]);

  const rows = persons ? mergePersonDirectory(persons, summary ?? []) : [];

  // While summary is still loading we cannot evaluate activity, so show all rows.
  const summaryReady = !summaryLoading && summary !== null;
  const filteredRows = filter === 'active' && summaryReady ? rows.filter(isPersonActive) : rows;

  const FILTER_LABELS: Record<PeopleFilter, string> = { active: '当前活跃', all: '全部' };
  const filters: PeopleFilter[] = ['active', 'all'];

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
      {persons !== null && rows.length > 0 && (
        <div className="flex gap-0 border-b border-dark-border">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                filter === f
                  ? 'border-b-2 border-accent-blue text-slate-100 -mb-px'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>
      )}
      {persons === null ? (
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
      ) : filteredRows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-dark-border bg-dark-card/50 p-8 text-center">
          <p className="text-lg font-medium text-slate-100">当前没有活跃人员</p>
          <p className="mt-2 text-sm text-slate-400">所有人员当前都没有运行中的任务、排队任务、活跃节点或显存占用。</p>
          <button
            onClick={() => setFilter('all')}
            className="mt-5 inline-flex items-center justify-center rounded-lg border border-accent-blue/30 bg-accent-blue/10 px-4 py-2 text-sm font-medium text-accent-blue transition-colors hover:border-accent-blue/50 hover:bg-accent-blue/15"
          >
            查看全部人员
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredRows.map((row) => (
            <Link key={row.id} to={`/people/${row.id}`} className="block rounded-2xl border border-dark-border bg-dark-card p-5 transition-colors hover:border-accent-blue/30">
              <p className="text-lg text-slate-100">{row.displayName}</p>
              <p className="mt-2 text-sm text-slate-500">{[row.email, row.qq].filter(Boolean).join(' · ') || row.note || '未填写联系信息'}</p>
              {summaryLoading ? (
                <PersonSummaryLoadingState />
              ) : (
                <div className="mt-4 space-y-1">
                  <p className="mt-2 text-sm text-slate-400">当前显存 {formatVramGB(row.currentVramMB)}</p>
                  <p className="mt-1 text-sm text-slate-400">运行 {row.runningTaskCount} · 排队 {row.queuedTaskCount}</p>
                  <p className="mt-1 text-xs text-slate-500">活跃节点 {row.activeServerCount}</p>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
