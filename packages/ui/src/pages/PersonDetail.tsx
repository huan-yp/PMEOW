import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useTransport } from '../transport/TransportProvider.js';
import type { PersonRecord, PersonTimelinePoint, MirroredAgentTaskRecord, PersonBindingRecord } from '@monitor/core';

export function PersonDetail() {
  const { id } = useParams<{ id: string }>();
  const transport = useTransport();
  const [person, setPerson] = useState<PersonRecord | null>(null);
  const [timeline, setTimeline] = useState<PersonTimelinePoint[]>([]);
  const [tasks, setTasks] = useState<MirroredAgentTaskRecord[]>([]);
  const [bindings, setBindings] = useState<PersonBindingRecord[]>([]);

  useEffect(() => {
    if (!id) return;
    void transport.getPersons().then(all => setPerson(all.find(p => p.id === id) ?? null)).catch(() => setPerson(null));
    void transport.getPersonTimeline(id).then(setTimeline).catch(() => setTimeline([]));
    void transport.getPersonTasks(id).then(setTasks).catch(() => setTasks([]));
    void transport.getPersonBindings(id).then(setBindings).catch(() => setBindings([]));
  }, [id, transport]);

  if (!person) return <div className="p-6 text-slate-400">加载中...</div>;

  return (
    <div className="p-6 space-y-6">
      <div>
        <p className="brand-kicker">PERSON</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-100">{person.displayName}</h1>
        <div className="mt-2 flex gap-4 text-sm text-slate-400">
          {person.email && <span>{person.email}</span>}
          {person.qq && <span>QQ: {person.qq}</span>}
          {person.note && <span>{person.note}</span>}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-dark-border bg-dark-card p-5">
          <h2 className="text-sm text-slate-400 mb-3">绑定</h2>
          {bindings.length === 0 ? (
            <p className="text-sm text-slate-500">无绑定</p>
          ) : (
            <div className="space-y-2">
              {bindings.map(b => (
                <div key={b.id} className="text-sm text-slate-300">
                  {b.serverId} · {b.systemUser}
                  <span className={`ml-2 text-xs ${b.enabled ? 'text-green-400' : 'text-slate-500'}`}>
                    {b.enabled ? '活跃' : '已禁用'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-dark-border bg-dark-card p-5">
          <h2 className="text-sm text-slate-400 mb-3">显存时间线</h2>
          {timeline.length === 0 ? (
            <p className="text-sm text-slate-500">暂无数据</p>
          ) : (
            <div className="space-y-1">
              {timeline.map(t => (
                <div key={t.bucketStart} className="flex justify-between text-sm text-slate-300">
                  <span>{new Date(t.bucketStart).toLocaleTimeString()}</span>
                  <span>{t.totalVramMB} MB</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-dark-border bg-dark-card p-5">
        <h2 className="text-sm text-slate-400 mb-3">关联任务</h2>
        {tasks.length === 0 ? (
          <p className="text-sm text-slate-500">暂无关联任务</p>
        ) : (
          <div className="space-y-2">
            {tasks.map(t => (
              <div key={t.taskId} className="flex justify-between text-sm text-slate-300">
                <span>{t.taskId}</span>
                <span className={t.status === 'running' ? 'text-green-400' : 'text-slate-400'}>{t.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
