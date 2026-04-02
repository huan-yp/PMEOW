import type { HookRule, ServerConfig } from '@monitor/core';

interface Props {
  hooks: HookRule[];
  servers: ServerConfig[];
  onEdit: (hook: HookRule) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onViewLogs: (hookId: string) => void;
  onTest: (hookId: string) => Promise<{ success: boolean; result?: string; error?: string }>;
}

const conditionLabels: Record<string, string> = {
  gpu_mem_below: '显存使用率 <',
  gpu_util_below: 'GPU 利用率 <',
  gpu_idle_duration: 'GPU 空闲持续 ≥',
};

const conditionUnits: Record<string, string> = {
  gpu_mem_below: '%',
  gpu_util_below: '%',
  gpu_idle_duration: ' 分钟',
};

const actionLabels: Record<string, string> = {
  exec_local: '执行本地命令',
  http_request: 'HTTP 请求',
  desktop_notify: '桌面通知',
};

export function HooksList({ hooks, servers, onEdit, onDelete, onToggle, onViewLogs, onTest }: Props) {
  if (hooks.length === 0) {
    return (
      <div className="border border-dashed border-dark-border rounded-xl flex items-center justify-center h-40">
        <p className="text-slate-500 text-sm">暂无钩子规则，点击「新建规则」创建</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {hooks.map(hook => {
        const server = servers.find(s => s.id === hook.condition.serverId);
        return (
          <div key={hook.id} className="bg-dark-card border border-dark-border rounded-lg p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-slate-200">{hook.name}</h3>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${hook.enabled ? 'bg-accent-green/10 text-accent-green' : 'bg-slate-700 text-slate-500'}`}>
                    {hook.enabled ? '启用' : '禁用'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  服务器: {server?.name ?? '未知'} · 
                  当 {conditionLabels[hook.condition.type]}{hook.condition.threshold}{conditionUnits[hook.condition.type]} → {actionLabels[hook.action.type]}
                </p>
                {hook.lastTriggeredAt && (
                  <p className="text-xs text-slate-600 mt-0.5">
                    上次触发: {new Date(hook.lastTriggeredAt).toLocaleString('zh-CN')}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 ml-2">
                <button onClick={() => onToggle(hook.id, !hook.enabled)}
                  className="px-2 py-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                  title={hook.enabled ? '禁用' : '启用'}>
                  {hook.enabled ? '⏸' : '▶'}
                </button>
                <button onClick={() => onViewLogs(hook.id)}
                  className="px-2 py-1 text-xs text-slate-500 hover:text-slate-300 transition-colors" title="日志">
                  📋
                </button>
                <button onClick={() => onTest(hook.id)}
                  className="px-2 py-1 text-xs text-slate-500 hover:text-slate-300 transition-colors" title="测试执行">
                  🧪
                </button>
                <button onClick={() => onEdit(hook)}
                  className="px-2 py-1 text-xs text-slate-500 hover:text-slate-300 transition-colors" title="编辑">
                  ✏️
                </button>
                <button onClick={() => { if (confirm(`确定删除规则「${hook.name}」？`)) onDelete(hook.id); }}
                  className="px-2 py-1 text-xs text-accent-red/60 hover:text-accent-red transition-colors" title="删除">
                  🗑
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
