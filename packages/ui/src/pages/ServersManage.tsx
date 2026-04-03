import { useState, useRef } from 'react';
import { useStore } from '../store/useStore.js';
import { useTransport } from '../transport/TransportProvider.js';
import type { ServerInput } from '@monitor/core';

export function ServersManage() {
  const transport = useTransport();
  const { servers, addServer, removeServer, updateServerInList } = useStore();
  const [editing, setEditing] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">节点管理</h1>
          <p className="mt-1 text-sm text-slate-500">管理 PMEOW 控制台中的节点接入配置。</p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setEditing(null); }}
          className="px-4 py-2 bg-accent-blue text-white text-sm rounded-lg hover:bg-accent-blue/80 transition-colors"
        >
          + 添加节点
        </button>
      </div>

      {showAdd && (
        <ServerForm
          onSubmit={async (input) => {
            const server = await transport.addServer(input);
            addServer(server);
            setShowAdd(false);
          }}
          onCancel={() => setShowAdd(false)}
          onTest={(input) => transport.testConnection(input)}
        />
      )}

      <div className="space-y-3">
        {servers.map((server) => (
          <div key={server.id} className="bg-dark-card border border-dark-border rounded-lg p-4">
            {editing === server.id ? (
              <ServerForm
                initial={server}
                onSubmit={async (input) => {
                  const updated = await transport.updateServer(server.id, input);
                  updateServerInList(updated);
                  setEditing(null);
                }}
                onCancel={() => setEditing(null)}
                onTest={(input) => transport.testConnection(input)}
              />
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-slate-200 font-medium">{server.name}</h3>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">{server.username}@{server.host}:{server.port}</p>
                  <p className="text-xs text-slate-600 mt-0.5">密钥: {server.privateKeyPath}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditing(server.id)}
                    className="px-3 py-1.5 text-xs text-slate-400 border border-dark-border rounded hover:bg-dark-hover transition-colors"
                  >
                    编辑
                  </button>
                  <button
                    onClick={async () => {
                      if (confirm(`确定删除节点「${server.name}」？`)) {
                        await transport.deleteServer(server.id);
                        removeServer(server.id);
                      }
                    }}
                    className="px-3 py-1.5 text-xs text-accent-red border border-accent-red/30 rounded hover:bg-accent-red/10 transition-colors"
                  >
                    删除
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

interface FormProps {
  initial?: ServerInput & { id?: string };
  onSubmit: (input: ServerInput) => Promise<void>;
  onCancel: () => void;
  onTest: (input: ServerInput) => Promise<{ success: boolean; error?: string }>;
}

function ServerForm({ initial, onSubmit, onCancel, onTest }: FormProps) {
  const transport = useTransport();
  const [name, setName] = useState(initial?.name ?? '');
  const [host, setHost] = useState(initial?.host ?? '');
  const [port, setPort] = useState(initial?.port ?? 22);
  const [username, setUsername] = useState(initial?.username ?? 'root');
  const [privateKeyPath, setPrivateKeyPath] = useState(initial?.privateKeyPath ?? '~/.ssh/id_rsa');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getInput = (): ServerInput => ({ name, host, port, username, privateKeyPath });

  const handleUploadKey = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await transport.uploadKey(file);
      setPrivateKeyPath(result.path);
    } catch (err: any) {
      alert('上传失败: ' + (err?.message ?? '未知错误'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="bg-dark-card border border-dark-border rounded-lg p-4 mb-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-500 block mb-1">名称</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Lab Node 1"
            className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 focus:border-accent-blue focus:outline-none" />
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">地址</label>
          <input value={host} onChange={e => setHost(e.target.value)} placeholder="192.168.1.100"
            className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 focus:border-accent-blue focus:outline-none" />
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">端口</label>
          <input type="number" value={port} onChange={e => setPort(Number(e.target.value))}
            className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 focus:border-accent-blue focus:outline-none" />
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">用户名</label>
          <input value={username} onChange={e => setUsername(e.target.value)}
            className="w-full bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 focus:border-accent-blue focus:outline-none" />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs text-slate-500 block mb-1">SSH 私钥路径</label>
          <div className="flex gap-2">
            <input value={privateKeyPath} onChange={e => setPrivateKeyPath(e.target.value)}
              className="flex-1 bg-dark-bg border border-dark-border rounded px-3 py-2 text-sm text-slate-200 font-mono focus:border-accent-blue focus:outline-none" />
            <input type="file" ref={fileInputRef} onChange={handleUploadKey} className="hidden" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="px-3 py-2 text-xs border border-accent-blue/30 text-accent-blue rounded hover:bg-accent-blue/10 transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {uploading ? '上传中...' : '上传密钥'}
            </button>
          </div>
        </div>
      </div>

      {testResult && (
        <div className={`mt-3 text-xs px-3 py-2 rounded ${testResult.success ? 'bg-accent-green/10 text-accent-green' : 'bg-accent-red/10 text-accent-red'}`}>
          {testResult.success ? '连接成功！' : `连接失败: ${testResult.error}`}
        </div>
      )}

      <div className="flex gap-2 mt-4">
        <button
          onClick={async () => {
            setTesting(true); setTestResult(null);
            const r = await onTest(getInput());
            setTestResult(r); setTesting(false);
          }}
          disabled={testing || !host}
          className="px-3 py-1.5 text-xs border border-accent-green/30 text-accent-green rounded hover:bg-accent-green/10 transition-colors disabled:opacity-50"
        >
          {testing ? '测试中...' : '测试连接'}
        </button>
        <button
          onClick={async () => {
            setSubmitting(true);
            await onSubmit(getInput());
            setSubmitting(false);
          }}
          disabled={submitting || !name || !host}
          className="px-4 py-1.5 text-xs bg-accent-blue text-white rounded hover:bg-accent-blue/80 transition-colors disabled:opacity-50"
        >
          {submitting ? '保存中...' : '保存'}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors">
          取消
        </button>
      </div>
    </div>
  );
}
