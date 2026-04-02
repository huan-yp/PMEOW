import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore.js';
import { useTransport } from '../transport/TransportProvider.js';
import type { AppSettings } from '@monitor/core';

export function Settings() {
  const transport = useTransport();
  const { settings, setSettings } = useStore();
  const [local, setLocal] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings) setLocal({ ...settings });
  }, [settings]);

  if (!local) return <div className="p-6 text-slate-500">加载中...</div>;

  const handleSave = async () => {
    setSaving(true);
    await transport.saveSettings(local);
    setSettings(local);
    setSaved(true);
    setSaving(false);
    setTimeout(() => setSaved(false), 2000);
  };

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setLocal(prev => prev ? { ...prev, [key]: value } : prev);
  };

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-100 mb-6">设置</h1>

      <div className="space-y-6">
        {/* Refresh interval */}
        <div className="bg-dark-card border border-dark-border rounded-lg p-4">
          <h3 className="text-sm font-medium text-slate-300 mb-3">数据采集</h3>
          <div>
            <label className="text-xs text-slate-500 block mb-1">刷新间隔 (毫秒)</label>
            <div className="flex items-center gap-3">
              <input type="range" min={1000} max={30000} step={1000}
                value={local.refreshIntervalMs}
                onChange={e => update('refreshIntervalMs', Number(e.target.value))}
                className="flex-1 accent-accent-blue" />
              <span className="text-sm text-slate-300 font-mono w-16 text-right">
                {local.refreshIntervalMs / 1000}s
              </span>
            </div>
          </div>
          <div className="mt-3">
            <label className="text-xs text-slate-500 block mb-1">历史数据保留天数</label>
            <input type="number" value={local.historyRetentionDays} min={1} max={90}
              onChange={e => update('historyRetentionDays', Number(e.target.value))}
              className="bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 w-24 focus:border-accent-blue focus:outline-none" />
          </div>
        </div>

        {/* Alert thresholds */}
        <div className="bg-dark-card border border-dark-border rounded-lg p-4">
          <h3 className="text-sm font-medium text-slate-300 mb-3">告警阈值</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">CPU (%)</label>
              <input type="number" value={local.alertCpuThreshold} min={0} max={100}
                onChange={e => update('alertCpuThreshold', Number(e.target.value))}
                className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 focus:border-accent-blue focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">内存 (%)</label>
              <input type="number" value={local.alertMemoryThreshold} min={0} max={100}
                onChange={e => update('alertMemoryThreshold', Number(e.target.value))}
                className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 focus:border-accent-blue focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">磁盘 (%)</label>
              <input type="number" value={local.alertDiskThreshold} min={0} max={100}
                onChange={e => update('alertDiskThreshold', Number(e.target.value))}
                className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 focus:border-accent-blue focus:outline-none" />
            </div>
          </div>
          <div className="mt-3">
            <label className="text-xs text-slate-500 block mb-1">监控磁盘挂载点</label>
            <input
              value={(local.alertDiskMountPoints ?? ['/']).join(',')}
              onChange={e => update('alertDiskMountPoints', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
              placeholder="逗号分隔，如: /,/home,/data"
              className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 font-mono focus:border-accent-blue focus:outline-none" />
          </div>
          <div className="mt-3">
            <label className="text-xs text-slate-500 block mb-1">告警忽略默认天数</label>
            <input type="number" value={local.alertSuppressDefaultDays ?? 7} min={1} max={365}
              onChange={e => update('alertSuppressDefaultDays', Number(e.target.value))}
              className="bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 w-24 focus:border-accent-blue focus:outline-none" />
          </div>
        </div>

        {/* API */}
        <div className="bg-dark-card border border-dark-border rounded-lg p-4">
          <h3 className="text-sm font-medium text-slate-300 mb-3">对外 API</h3>
          <div className="flex items-center gap-3 mb-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={local.apiEnabled}
                onChange={e => update('apiEnabled', e.target.checked)}
                className="accent-accent-blue" />
              <span className="text-sm text-slate-300">启用 HTTP API</span>
            </label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">端口</label>
              <input type="number" value={local.apiPort}
                onChange={e => update('apiPort', Number(e.target.value))}
                className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 focus:border-accent-blue focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Token (留空不验证)</label>
              <input value={local.apiToken}
                onChange={e => update('apiToken', e.target.value)}
                placeholder="可选"
                className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 font-mono focus:border-accent-blue focus:outline-none" />
            </div>
          </div>
        </div>

        {/* Web password — only shown in web mode */}
        {!transport.isElectron && (
          <div className="bg-dark-card border border-dark-border rounded-lg p-4">
            <h3 className="text-sm font-medium text-slate-300 mb-3">登录密码</h3>
            <p className="text-xs text-slate-500 mb-2">修改 Web 模式登录密码</p>
            <input
              type="password"
              placeholder="输入新密码后保存即可修改"
              onChange={e => update('password', e.target.value)}
              className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 focus:border-accent-blue focus:outline-none"
            />
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button onClick={handleSave} disabled={saving}
          className="px-6 py-2 bg-accent-blue text-white text-sm rounded-lg hover:bg-accent-blue/80 transition-colors disabled:opacity-50">
          {saving ? '保存中...' : '保存设置'}
        </button>
        {saved && <span className="text-sm text-accent-green">已保存 ✓</span>}
      </div>
    </div>
  );
}
