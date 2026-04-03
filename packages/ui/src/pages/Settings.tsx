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
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (settings) setLocal({ ...settings });
  }, [settings]);

  if (!local) return <div className="p-6 text-slate-500">加载中...</div>;

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);

    try {
      await transport.saveSettings(local);
      setSettings(local);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setSaveError('保存失败，请重试');
    } finally {
      setSaving(false);
    }
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
            <label htmlFor="refreshIntervalMs" className="text-xs text-slate-500 block mb-1">刷新间隔 (毫秒)</label>
            <div className="flex items-center gap-3">
              <input id="refreshIntervalMs" type="range" min={1000} max={30000} step={1000}
                value={local.refreshIntervalMs}
                onChange={e => update('refreshIntervalMs', Number(e.target.value))}
                className="flex-1 accent-accent-blue" />
              <span className="text-sm text-slate-300 font-mono w-16 text-right">
                {local.refreshIntervalMs / 1000}s
              </span>
            </div>
          </div>
          <div className="mt-3">
            <label htmlFor="historyRetentionDays" className="text-xs text-slate-500 block mb-1">历史数据保留天数</label>
            <input id="historyRetentionDays" type="number" value={local.historyRetentionDays} min={1} max={90}
              onChange={e => update('historyRetentionDays', Number(e.target.value))}
              className="bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 w-24 focus:border-accent-blue focus:outline-none" />
          </div>
        </div>

        {/* Alert thresholds */}
        <div className="bg-dark-card border border-dark-border rounded-lg p-4">
          <h3 className="text-sm font-medium text-slate-300 mb-3">告警阈值</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label htmlFor="alertCpuThreshold" className="text-xs text-slate-500 block mb-1">CPU (%)</label>
              <input id="alertCpuThreshold" type="number" value={local.alertCpuThreshold} min={0} max={100}
                onChange={e => update('alertCpuThreshold', Number(e.target.value))}
                className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 focus:border-accent-blue focus:outline-none" />
            </div>
            <div>
              <label htmlFor="alertMemoryThreshold" className="text-xs text-slate-500 block mb-1">内存 (%)</label>
              <input id="alertMemoryThreshold" type="number" value={local.alertMemoryThreshold} min={0} max={100}
                onChange={e => update('alertMemoryThreshold', Number(e.target.value))}
                className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 focus:border-accent-blue focus:outline-none" />
            </div>
            <div>
              <label htmlFor="alertDiskThreshold" className="text-xs text-slate-500 block mb-1">磁盘 (%)</label>
              <input id="alertDiskThreshold" type="number" value={local.alertDiskThreshold} min={0} max={100}
                onChange={e => update('alertDiskThreshold', Number(e.target.value))}
                className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 focus:border-accent-blue focus:outline-none" />
            </div>
          </div>
          <div className="mt-3">
            <label htmlFor="alertDiskMountPoints" className="text-xs text-slate-500 block mb-1">监控磁盘挂载点</label>
            <input
              id="alertDiskMountPoints"
              value={(local.alertDiskMountPoints ?? ['/']).join(',')}
              onChange={e => update('alertDiskMountPoints', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
              placeholder="逗号分隔，如: /,/home,/data"
              className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 font-mono focus:border-accent-blue focus:outline-none" />
          </div>
          <div className="mt-3">
            <label htmlFor="alertSuppressDefaultDays" className="text-xs text-slate-500 block mb-1">告警忽略默认天数</label>
            <input id="alertSuppressDefaultDays" type="number" value={local.alertSuppressDefaultDays ?? 7} min={1} max={365}
              onChange={e => update('alertSuppressDefaultDays', Number(e.target.value))}
              className="bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 w-24 focus:border-accent-blue focus:outline-none" />
          </div>
        </div>

        <div className="bg-dark-card border border-dark-border rounded-lg p-4">
          <h3 className="text-sm font-medium text-slate-300 mb-3">安全审计</h3>
          <div className="space-y-3">
            <div>
              <label htmlFor="securityMiningKeywords" className="text-xs text-slate-500 block mb-1">挖矿关键词</label>
              <input
                id="securityMiningKeywords"
                value={(local.securityMiningKeywords ?? []).join(', ')}
                onChange={e => update('securityMiningKeywords', e.target.value.split(',').map((item) => item.trim()).filter(Boolean))}
                className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 font-mono focus:border-accent-blue focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label htmlFor="securityUnownedGpuMinutes" className="text-xs text-slate-500 block mb-1">无归属 GPU 持续分钟</label>
                <input
                  id="securityUnownedGpuMinutes"
                  type="number"
                  value={local.securityUnownedGpuMinutes}
                  min={1}
                  onChange={e => update('securityUnownedGpuMinutes', Number(e.target.value))}
                  className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 focus:border-accent-blue focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="securityHighGpuUtilizationPercent" className="text-xs text-slate-500 block mb-1">高 GPU 利用率阈值 (%)</label>
                <input
                  id="securityHighGpuUtilizationPercent"
                  type="number"
                  value={local.securityHighGpuUtilizationPercent}
                  min={1}
                  max={100}
                  onChange={e => update('securityHighGpuUtilizationPercent', Number(e.target.value))}
                  className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 focus:border-accent-blue focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="securityHighGpuDurationMinutes" className="text-xs text-slate-500 block mb-1">高 GPU 利用率持续分钟</label>
                <input
                  id="securityHighGpuDurationMinutes"
                  type="number"
                  value={local.securityHighGpuDurationMinutes}
                  min={1}
                  onChange={e => update('securityHighGpuDurationMinutes', Number(e.target.value))}
                  className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 focus:border-accent-blue focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-dark-card border border-dark-border rounded-lg p-4">
          <h3 className="text-sm font-medium text-slate-300 mb-2">Agent 部署说明</h3>
          <p className="text-sm text-slate-400 leading-6">
            在目标机器安装 pmeow-agent 后，使用 systemd 注册服务并保持 agentId 稳定，平台会自动把任务队列、GPU 归属和安全审计接入该节点。
          </p>
        </div>

        {/* Agent metrics timeout */}
        <div className="bg-dark-card border border-dark-border rounded-lg p-4">
          <h3 className="text-sm font-medium text-slate-300 mb-3">Agent 离线检测</h3>
          <div>
            <label htmlFor="agentMetricsTimeoutMs" className="text-xs text-slate-500 block mb-1">指标超时 (秒)</label>
            <div className="flex items-center gap-3">
              <input id="agentMetricsTimeoutMs" type="number"
                min={5} max={300} step={1}
                value={Math.round(local.agentMetricsTimeoutMs / 1000)}
                onChange={e => update('agentMetricsTimeoutMs', Number(e.target.value) * 1000)}
                className="bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 w-24 focus:border-accent-blue focus:outline-none" />
              <span className="text-xs text-slate-500">超过此时间未收到指标，节点将标记为离线</span>
            </div>
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
              <label htmlFor="apiPort" className="text-xs text-slate-500 block mb-1">端口</label>
              <input id="apiPort" type="number" value={local.apiPort}
                onChange={e => update('apiPort', Number(e.target.value))}
                className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 focus:border-accent-blue focus:outline-none" />
            </div>
            <div>
              <label htmlFor="apiToken" className="text-xs text-slate-500 block mb-1">Token (留空不验证)</label>
              <input id="apiToken" value={local.apiToken}
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
        {saveError && <span className="text-sm text-accent-red">{saveError}</span>}
      </div>
    </div>
  );
}
