import { useState, useEffect } from 'react';
import { getPersonMobilePreferences, updatePersonMobilePreferences } from '../../api/person.js';
import { MobilePageHeading } from '../../components/MobilePageHeading.js';
import { SettingsIcon } from '../../components/MobileIcons.js';
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

  if (!prefs) {
    return (
      <div className="brand-card rounded-[24px] px-4 py-6">
        <p className="brand-kicker">preferences</p>
        <p className="mt-2 text-sm text-slate-300">正在加载通知设置...</p>
      </div>
    );
  }

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
      <MobilePageHeading
        kicker="preferences"
        title="通知设置"
        description="同步个人移动端的提醒偏好，与 Web 端保持一致的通知节奏。"
        aside={
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-accent-cyan">
            <SettingsIcon className="h-5 w-5" />
          </div>
        }
      />
      <div className="space-y-2">
        {switches.map(s => (
          <div key={s.key} className="brand-card flex items-center justify-between rounded-[24px] p-4">
            <span className="text-sm font-medium text-slate-100">{s.label}</span>
            <button
              type="button"
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
