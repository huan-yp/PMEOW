import { useState, useEffect } from 'react';
import { getPersonMobilePreferences, updatePersonMobilePreferences } from '../../api/person.js';
import type { PersonMobilePreferenceRecord } from '@monitor/core';

export function PersonSettings() {
  const [prefs, setPrefs] = useState<PersonMobilePreferenceRecord | null>(null);

  useEffect(() => {
    void getPersonMobilePreferences().then(setPrefs).catch(() => setPrefs(null));
  }, []);

  const toggle = async (key: keyof Omit<PersonMobilePreferenceRecord, 'personId' | 'updatedAt' | 'minAvailableGpuCount' | 'minAvailableVramGB'>) => {
    if (!prefs) return;
    const updated = await updatePersonMobilePreferences({ [key]: !prefs[key] });
    setPrefs(updated);
  };

  if (!prefs) return <p className="text-sm text-slate-400">加载中...</p>;

  const switches: Array<{ key: keyof PersonMobilePreferenceRecord; label: string }> = [
    { key: 'notifyTaskStarted', label: '任务开始通知' },
    { key: 'notifyTaskCompleted', label: '任务完成通知' },
    { key: 'notifyTaskFailed', label: '任务失败通知' },
    { key: 'notifyTaskCancelled', label: '任务取消通知' },
    { key: 'notifyNodeStatus', label: '节点状态通知' },
    { key: 'notifyGpuAvailable', label: 'GPU 可用通知' },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-slate-100">通知设置</h1>
      <div className="space-y-2">
        {switches.map(s => (
          <div key={s.key} className="flex items-center justify-between rounded-xl border border-dark-border bg-dark-card p-3">
            <span className="text-sm text-slate-200">{s.label}</span>
            <button
              onClick={() => void toggle(s.key as any)}
              className={`relative h-6 w-11 rounded-full transition-colors ${prefs[s.key] ? 'bg-accent-blue' : 'bg-slate-600'}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${prefs[s.key] ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
