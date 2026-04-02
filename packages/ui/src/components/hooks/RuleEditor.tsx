import { useState } from 'react';
import type { ServerConfig, HookRule, HookRuleInput, HookConditionType, HookAction } from '@monitor/core';

interface Props {
  servers: ServerConfig[];
  initial?: HookRule;
  onSubmit: (input: HookRuleInput) => Promise<void>;
  onCancel: () => void;
}

const TEMPLATE_VARS = [
  '{{serverName}}', '{{serverHost}}', '{{gpuMemUsage}}',
  '{{gpuUtil}}', '{{gpuIdleMinutes}}', '{{timestamp}}',
  '{{cpuUsage}}', '{{memUsage}}',
];

export function RuleEditor({ servers, initial, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [serverId, setServerId] = useState(initial?.condition.serverId ?? servers[0]?.id ?? '');
  const [condType, setCondType] = useState<HookConditionType>(initial?.condition.type ?? 'gpu_mem_below');
  const [threshold, setThreshold] = useState(initial?.condition.threshold ?? 10);

  // Action
  const [actionType, setActionType] = useState(initial?.action.type ?? 'desktop_notify');
  // exec_local
  const [execCmd, setExecCmd] = useState(initial?.action.type === 'exec_local' ? initial.action.command : '');
  // http_request
  const [httpUrl, setHttpUrl] = useState(initial?.action.type === 'http_request' ? initial.action.url : '');
  const [httpMethod, setHttpMethod] = useState<'GET' | 'POST' | 'PUT'>(initial?.action.type === 'http_request' ? initial.action.method : 'POST');
  const [httpHeaders, setHttpHeaders] = useState(initial?.action.type === 'http_request' ? JSON.stringify(initial.action.headers, null, 2) : '{"Content-Type": "application/json"}');
  const [httpBody, setHttpBody] = useState(initial?.action.type === 'http_request' ? initial.action.body : '');
  // desktop_notify
  const [notifyTitle, setNotifyTitle] = useState(initial?.action.type === 'desktop_notify' ? initial.action.title : '{{serverName}} GPU 空闲');
  const [notifyBody, setNotifyBody] = useState(initial?.action.type === 'desktop_notify' ? initial.action.body : 'GPU 使用率 {{gpuUtil}}%, 显存 {{gpuMemUsage}}%');

  const [submitting, setSubmitting] = useState(false);

  const buildAction = (): HookAction => {
    switch (actionType) {
      case 'exec_local':
        return { type: 'exec_local', command: execCmd };
      case 'http_request':
        let headers: Record<string, string> = {};
        try { headers = JSON.parse(httpHeaders); } catch { /* ignore */ }
        return { type: 'http_request', url: httpUrl, method: httpMethod, headers, body: httpBody };
      case 'desktop_notify':
        return { type: 'desktop_notify', title: notifyTitle, body: notifyBody };
      default:
        return { type: 'desktop_notify', title: '', body: '' };
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    await onSubmit({
      name,
      enabled,
      condition: { type: condType, threshold, serverId },
      action: buildAction(),
    });
    setSubmitting(false);
  };

  return (
    <div className="bg-dark-card border border-accent-blue/30 rounded-lg p-5 mb-4">
      <h3 className="text-sm font-medium text-slate-300 mb-4">{initial ? '编辑规则' : '新建规则'}</h3>

      {/* Basic */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div>
          <label className="text-xs text-slate-500 block mb-1">规则名称</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="GPU 空闲提醒"
            className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 focus:border-accent-blue focus:outline-none" />
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">目标服务器</label>
          <select value={serverId} onChange={e => setServerId(e.target.value)}
            className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 focus:border-accent-blue focus:outline-none">
            {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {/* Condition */}
      <div className="mb-4">
        <h4 className="text-xs text-slate-500 font-medium mb-2">触发条件</h4>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <select value={condType} onChange={e => setCondType(e.target.value as HookConditionType)}
              className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 focus:border-accent-blue focus:outline-none">
              <option value="gpu_mem_below">显存使用率低于</option>
              <option value="gpu_util_below">GPU 利用率低于</option>
              <option value="gpu_idle_duration">GPU 空闲持续超过</option>
            </select>
          </div>
          <div className="w-32">
            <div className="flex items-center gap-1">
              <input type="number" value={threshold} onChange={e => setThreshold(Number(e.target.value))}
                min={0} max={condType === 'gpu_idle_duration' ? 1440 : 100}
                className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 focus:border-accent-blue focus:outline-none" />
              <span className="text-xs text-slate-500 whitespace-nowrap">
                {condType === 'gpu_idle_duration' ? '分钟' : '%'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Action */}
      <div className="mb-4">
        <h4 className="text-xs text-slate-500 font-medium mb-2">触发动作</h4>
        <select value={actionType} onChange={e => setActionType(e.target.value as HookAction['type'])}
          className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 focus:border-accent-blue focus:outline-none mb-3">
          <option value="desktop_notify">桌面通知 / Toast</option>
          <option value="exec_local">执行本地命令</option>
          <option value="http_request">HTTP 请求</option>
        </select>

        {actionType === 'exec_local' && (
          <div>
            <input value={execCmd} onChange={e => setExecCmd(e.target.value)} placeholder="echo '{{serverName}} GPU idle' >> /tmp/hook.log"
              className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 font-mono focus:border-accent-blue focus:outline-none" />
          </div>
        )}

        {actionType === 'http_request' && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <select value={httpMethod} onChange={e => setHttpMethod(e.target.value as 'GET' | 'POST' | 'PUT')}
                className="bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 focus:outline-none w-24">
                <option>GET</option>
                <option>POST</option>
                <option>PUT</option>
              </select>
              <input value={httpUrl} onChange={e => setHttpUrl(e.target.value)} placeholder="https://example.com/webhook"
                className="flex-1 bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 focus:border-accent-blue focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-slate-600 block mb-1">Headers (JSON)</label>
              <textarea value={httpHeaders} onChange={e => setHttpHeaders(e.target.value)} rows={2}
                className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-xs text-slate-200 font-mono focus:border-accent-blue focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-slate-600 block mb-1">Body</label>
              <textarea value={httpBody} onChange={e => setHttpBody(e.target.value)} rows={3}
                placeholder='{"text": "{{serverName}} GPU 空闲了，利用率 {{gpuUtil}}%"}'
                className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-xs text-slate-200 font-mono focus:border-accent-blue focus:outline-none" />
            </div>
          </div>
        )}

        {actionType === 'desktop_notify' && (
          <div className="space-y-2">
            <input value={notifyTitle} onChange={e => setNotifyTitle(e.target.value)} placeholder="标题"
              className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 focus:border-accent-blue focus:outline-none" />
            <input value={notifyBody} onChange={e => setNotifyBody(e.target.value)} placeholder="正文"
              className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 focus:border-accent-blue focus:outline-none" />
          </div>
        )}

        {/* Template variables help */}
        <div className="mt-2 flex flex-wrap gap-1">
          <span className="text-xs text-slate-600">可用变量:</span>
          {TEMPLATE_VARS.map(v => (
            <code key={v} className="text-xs bg-dark-bg text-accent-cyan px-1.5 py-0.5 rounded border border-dark-border cursor-pointer hover:bg-dark-hover"
              onClick={() => navigator.clipboard.writeText(v)}>
              {v}
            </code>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button onClick={handleSubmit} disabled={submitting || !name || !serverId}
          className="px-4 py-2 text-sm bg-accent-blue text-white rounded-lg hover:bg-accent-blue/80 transition-colors disabled:opacity-50">
          {submitting ? '保存中...' : '保存'}
        </button>
        <button onClick={onCancel} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-300 transition-colors">
          取消
        </button>
      </div>
    </div>
  );
}
