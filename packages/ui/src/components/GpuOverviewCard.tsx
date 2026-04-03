import { useEffect, useState } from 'react';
import type { GpuOverviewResponse } from '@monitor/core';
import { useTransport } from '../transport/TransportProvider.js';
import { formatVramGB } from '../utils/vram.js';

export function GpuOverviewCard() {
  const transport = useTransport();
  const [overview, setOverview] = useState<GpuOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const next = await transport.getGpuOverview();
        if (!cancelled) {
          setOverview(next);
        }
      } catch {
        if (!cancelled) {
          setOverview(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [transport]);

  const topUsers = overview?.users.slice(0, 5) ?? [];

  return (
    <div className="brand-card rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-100">GPU 归属总览</h2>
          <p className="text-xs text-slate-500 mt-1">按用户汇总当前节点集群显存占用</p>
        </div>
        {overview && (
          <span className="text-xs text-slate-600 font-mono">
            {new Date(overview.generatedAt).toLocaleTimeString('zh-CN', { hour12: false })}
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">加载中...</p>
      ) : topUsers.length === 0 ? (
        <p className="text-sm text-slate-500">暂无 GPU 占用数据</p>
      ) : (
        <div className="space-y-2">
          {topUsers.map((item, index) => (
            <div key={item.user} className="flex items-center justify-between gap-3 rounded-lg border border-dark-border/70 bg-dark-bg/40 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm text-slate-200 truncate">{index + 1}. {item.user}</p>
                <p className="text-xs text-slate-500">任务 {item.taskCount} · 进程 {item.processCount}</p>
              </div>
              <span className="text-sm font-mono text-accent-blue shrink-0">{formatVramGB(item.totalVramMB)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}