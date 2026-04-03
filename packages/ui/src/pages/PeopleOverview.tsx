import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTransport } from '../transport/TransportProvider.js';
import type { PersonRecord, PersonSummaryItem } from '@monitor/core';

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

export function PeopleOverview() {
  const transport = useTransport();
  const [rows, setRows] = useState<PersonDirectoryRow[]>([]);

  useEffect(() => {
    let cancelled = false;

    void Promise.allSettled([transport.getPersons(), transport.getPersonSummary()])
      .then(([personsResult, summaryResult]) => {
        if (cancelled) {
          return;
        }

        const persons = personsResult.status === 'fulfilled' ? personsResult.value : [];
        const summary = summaryResult.status === 'fulfilled' ? summaryResult.value : [];
        setRows(mergePersonDirectory(persons, summary));
      })
      .catch(() => {
        if (!cancelled) {
          setRows([]);
        }
      });

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
      {rows.length === 0 ? (
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
              <p className="mt-2 text-sm text-slate-400">当前显存 {row.currentVramMB} MB</p>
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
