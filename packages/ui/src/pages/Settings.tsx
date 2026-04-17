import { useState, useEffect } from 'react';
import { useTransport } from '../transport/TransportProvider.js';
import type { Settings as SettingsType } from '../transport/types.js';

export default function Settings() {
  const transport = useTransport();
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [cpuThreshold, setCpuThreshold] = useState(90);
  const [memThreshold, setMemThreshold] = useState(90);
  const [diskThreshold, setDiskThreshold] = useState(90);
  const [gpuTempThreshold, setGpuTempThreshold] = useState(85);

  const [newPassword, setNewPassword] = useState('');
  const [passwordSaved, setPasswordSaved] = useState(false);

  useEffect(() => {
    transport.getSettings()
      .then((s) => {
        setSettings(s);
        setCpuThreshold(s.alertCpuThreshold ?? 90);
        setMemThreshold(s.alertMemoryThreshold ?? 90);
        setDiskThreshold(s.alertDiskThreshold ?? 90);
        setGpuTempThreshold(s.alertGpuTempThreshold ?? 85);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [transport]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await transport.saveSettings({
        alertCpuThreshold: cpuThreshold,
        alertMemoryThreshold: memThreshold,
        alertDiskThreshold: diskThreshold,
        alertGpuTempThreshold: gpuTempThreshold,
      });
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handlePasswordChange = async () => {
    if (!newPassword.trim()) return;
    try {
      await transport.login(newPassword);
      setNewPassword('');
      setPasswordSaved(true);
      setTimeout(() => setPasswordSaved(false), 3000);
    } catch { /* ignore */ }
  };

  if (loading) return <div className="p-8 text-center text-slate-500">加载中...</div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <p className="brand-kicker">系统设置</p>
        <h2 className="text-xl font-bold text-slate-100">设置</h2>
      </div>

      <div className="rounded-2xl border border-dark-border bg-dark-card p-6 space-y-4">
        <h3 className="text-sm font-medium text-slate-300">告警阈值</h3>
        <ThresholdInput label="CPU 使用率 (%)" value={cpuThreshold} onChange={setCpuThreshold} />
        <ThresholdInput label="内存使用率 (%)" value={memThreshold} onChange={setMemThreshold} />
        <ThresholdInput label="磁盘使用率 (%)" value={diskThreshold} onChange={setDiskThreshold} />
        <ThresholdInput label="GPU 温度 (°C)" value={gpuTempThreshold} onChange={setGpuTempThreshold} />
        <button onClick={handleSave} disabled={saving} className="rounded-lg bg-accent-blue px-4 py-2 text-sm text-white hover:bg-accent-blue/80 disabled:opacity-50">
          {saving ? '保存中...' : '保存阈值'}
        </button>
      </div>

      <div className="rounded-2xl border border-dark-border bg-dark-card p-6 space-y-4">
        <h3 className="text-sm font-medium text-slate-300">修改密码</h3>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="输入新密码"
          className="w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-slate-200 outline-none"
        />
        <div className="flex items-center gap-3">
          <button onClick={handlePasswordChange} className="rounded-lg bg-accent-blue px-4 py-2 text-sm text-white hover:bg-accent-blue/80">修改密码</button>
          {passwordSaved && <span className="text-xs text-accent-green">密码已更新</span>}
        </div>
      </div>
    </div>
  );
}

function ThresholdInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <label className="text-sm text-slate-400">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 rounded-lg border border-dark-border bg-dark-bg px-3 py-1.5 text-sm text-slate-200 text-right outline-none"
      />
    </div>
  );
}
