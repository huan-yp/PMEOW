import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore.js';
import { useTransport } from '../transport/TransportProvider.js';
import { HooksList } from '../components/hooks/HooksList.js';
import { RuleEditor } from '../components/hooks/RuleEditor.js';
import type { HookRule, HookRuleInput, HookLog } from '@monitor/core';

export function HooksManage() {
  const transport = useTransport();
  const { hooks, setHooks, servers } = useStore();
  const [showEditor, setShowEditor] = useState(false);
  const [editingHook, setEditingHook] = useState<HookRule | null>(null);
  const [viewingLogs, setViewingLogs] = useState<string | null>(null);
  const [logs, setLogs] = useState<HookLog[]>([]);

  useEffect(() => {
    transport.getHooks().then(setHooks);
  }, [transport, setHooks]);

  const handleCreate = async (input: HookRuleInput) => {
    const hook = await transport.createHook(input);
    setHooks([...hooks, hook]);
    setShowEditor(false);
  };

  const handleUpdate = async (id: string, input: Partial<HookRuleInput>) => {
    const updated = await transport.updateHook(id, input);
    setHooks(hooks.map(h => h.id === id ? updated : h));
    setShowEditor(false);
    setEditingHook(null);
  };

  const handleDelete = async (id: string) => {
    await transport.deleteHook(id);
    setHooks(hooks.filter(h => h.id !== id));
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    const updated = await transport.updateHook(id, { enabled });
    setHooks(hooks.map(h => h.id === id ? updated : h));
  };

  const handleViewLogs = async (hookId: string) => {
    setViewingLogs(hookId);
    const data = await transport.getHookLogs(hookId);
    setLogs(data);
  };

  const handleTest = async (hookId: string) => {
    return transport.testHookAction(hookId);
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">钩子规则</h1>
          <p className="text-sm text-slate-500 mt-1">配置 GPU 空闲时自动触发的操作</p>
        </div>
        <button
          onClick={() => { setShowEditor(true); setEditingHook(null); }}
          className="px-4 py-2 bg-accent-blue text-white text-sm rounded-lg hover:bg-accent-blue/80 transition-colors"
        >
          + 新建规则
        </button>
      </div>

      {(showEditor || editingHook) && (
        <RuleEditor
          servers={servers}
          initial={editingHook ?? undefined}
          onSubmit={editingHook
            ? (input) => handleUpdate(editingHook.id, input)
            : handleCreate
          }
          onCancel={() => { setShowEditor(false); setEditingHook(null); }}
        />
      )}

      <HooksList
        hooks={hooks}
        servers={servers}
        onEdit={(hook) => { setEditingHook(hook); setShowEditor(false); }}
        onDelete={handleDelete}
        onToggle={handleToggle}
        onViewLogs={handleViewLogs}
        onTest={handleTest}
      />

      {/* Logs drawer */}
      {viewingLogs && (
        <div className="fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setViewingLogs(null)} />
          <div className="ml-auto relative w-full max-w-md bg-dark-card border-l border-dark-border h-full overflow-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-200">执行日志</h2>
              <button onClick={() => setViewingLogs(null)} className="text-slate-500 hover:text-slate-300">✕</button>
            </div>
            <div className="space-y-2">
              {logs.length === 0 ? (
                <p className="text-slate-600 text-sm text-center py-8">暂无执行记录</p>
              ) : logs.map(log => (
                <div key={log.id} className={`border rounded-lg p-3 text-xs ${
                  log.success ? 'border-accent-green/20 bg-accent-green/5' : 'border-accent-red/20 bg-accent-red/5'
                }`}>
                  <div className="flex justify-between mb-1">
                    <span className={log.success ? 'text-accent-green' : 'text-accent-red'}>
                      {log.success ? '成功' : '失败'}
                    </span>
                    <span className="text-slate-500">{new Date(log.triggeredAt).toLocaleString('zh-CN')}</span>
                  </div>
                  {log.result && <p className="text-slate-400 break-words">{log.result}</p>}
                  {log.error && <p className="text-accent-red/80 break-words">{log.error}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
