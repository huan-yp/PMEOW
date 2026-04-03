import { useState, useEffect } from 'react';
import { useTransport } from '../transport/TransportProvider.js';
import type { PersonRecord, PersonBindingSuggestion } from '@monitor/core';

export function PeopleManage() {
  const transport = useTransport();
  const [persons, setPersons] = useState<PersonRecord[]>([]);
  const [suggestions, setSuggestions] = useState<PersonBindingSuggestion[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ displayName: '', email: '', qq: '', note: '' });

  useEffect(() => {
    void transport.getPersons().then(setPersons).catch(() => setPersons([]));
    void transport.getPersonBindingSuggestions().then(setSuggestions).catch(() => setSuggestions([]));
  }, [transport]);

  const handleAdd = async () => {
    if (!form.displayName.trim()) return;
    try {
      await transport.createPerson({ displayName: form.displayName, email: form.email, qq: form.qq, note: form.note, customFields: {} });
      setForm({ displayName: '', email: '', qq: '', note: '' });
      setShowAdd(false);
      const updated = await transport.getPersons();
      setPersons(updated);
    } catch { /* network error - form stays open for retry */ }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="brand-kicker">PEOPLE</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-100">人员管理</h1>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white hover:bg-accent-blue/80">
          添加人员
        </button>
      </div>

      {showAdd && (
        <div className="rounded-2xl border border-dark-border bg-dark-card p-5 space-y-3">
          <input value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))} placeholder="显示名称" className="w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-slate-200" />
          <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="邮箱" className="w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-slate-200" />
          <input value={form.qq} onChange={e => setForm(f => ({ ...f, qq: e.target.value }))} placeholder="QQ" className="w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-slate-200" />
          <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="备注" className="w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-slate-200" />
          <button onClick={handleAdd} className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white hover:bg-accent-blue/80">保存</button>
        </div>
      )}

      <div className="space-y-3">
        {persons.map(p => (
          <div key={p.id} className="flex items-center justify-between rounded-2xl border border-dark-border bg-dark-card p-4">
            <div>
              <p className="text-sm font-medium text-slate-100">{p.displayName}</p>
              <p className="text-xs text-slate-500">{[p.email, p.qq].filter(Boolean).join(' · ') || '无联系信息'}</p>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-xs ${p.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-slate-500/20 text-slate-400'}`}>
              {p.status === 'active' ? '活跃' : '已归档'}
            </span>
          </div>
        ))}
      </div>

      {suggestions.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-slate-100 mt-6 mb-3">绑定建议</h2>
          <div className="space-y-2">
            {suggestions.map(s => (
              <div key={`${s.serverId}-${s.systemUser}`} className="rounded-lg border border-dark-border bg-dark-card/50 p-3 text-sm text-slate-300">
                <span className="text-slate-400">{s.serverName}</span> · <span>{s.systemUser}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
