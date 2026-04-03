import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTransport } from '../transport/TransportProvider.js';
import type { PersonSummaryItem } from '@monitor/core';

export function PeopleOverview() {
  const transport = useTransport();
  const [rows, setRows] = useState<PersonSummaryItem[]>([]);

  useEffect(() => {
    void transport.getPersonSummary().then(setRows).catch(() => setRows([]));
  }, [transport]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <p className="brand-kicker">PEOPLE</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-100">人员概览</h1>
      </div>
      {rows.length === 0 ? (
        <p className="text-slate-400">尚未配置人员信息。</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <Link key={row.personId} to={`/people/${row.personId}`} className="block rounded-2xl border border-dark-border bg-dark-card p-5 transition-colors hover:border-accent-blue/30">
              <p className="text-lg text-slate-100">{row.displayName}</p>
              <p className="mt-2 text-sm text-slate-400">当前显存 {row.currentVramMB} MB</p>
              <p className="mt-1 text-sm text-slate-400">运行 {row.runningTaskCount} · 排队 {row.queuedTaskCount}</p>
              <p className="mt-1 text-xs text-slate-500">活跃节点 {row.activeServerCount}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
