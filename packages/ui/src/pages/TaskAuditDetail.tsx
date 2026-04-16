import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AgentTaskAuditDetail, AgentTaskEventRecord } from '@monitor/core';
import { useTransport } from '../transport/TransportProvider.js';

type LoadState = 'loading' | 'loaded' | 'error';

function formatTimestamp(epoch: number | null | undefined) {
  if (!epoch) return '-';
  return new Date(epoch * 1000).toLocaleString('zh-CN', { hour12: false });
}

function formatEventType(type: string) {
  const labels: Record<string, string> = {
    submitted: '已提交',
    schedule_blocked: '调度阻塞',
    schedule_started: '调度成功',
    queue_paused: '队列暂停',
    launch_reserved: '启动预留',
    launch_reservation_expired: '预留过期',
    process_started: '进程启动',
    finalized: '已终结',
    runtime_orphan_detected: '孤儿进程',
    daemon_restart: '守护进程重启',
  };
  return labels[type] ?? type;
}

function formatStatus(status: string | undefined) {
  switch (status) {
    case 'queued': return '排队中';
    case 'running': return '运行中';
    case 'completed': return '已完成';
    case 'failed': return '失败';
    case 'cancelled': return '已取消';
    default: return status ?? '-';
  }
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-1">
      <span className="w-40 shrink-0 text-slate-500">{label}</span>
      <span className="text-slate-200">{value ?? '-'}</span>
    </div>
  );
}

function EventDetails({ details }: { details: Record<string, unknown> | null }) {
  if (!details || Object.keys(details).length === 0) return null;

  return (
    <pre className="mt-2 max-h-60 overflow-auto rounded bg-dark-bg/80 p-2 text-xs text-slate-400">
      {JSON.stringify(details, null, 2)}
    </pre>
  );
}

function GpuLedgerTable({ ledgers }: { ledgers: unknown }) {
  if (!Array.isArray(ledgers) || ledgers.length === 0) return null;

  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-dark-border text-left text-slate-500">
            <th className="pb-1 pr-3">GPU</th>
            <th className="pb-1 pr-3">管理预留 MB</th>
            <th className="pb-1 pr-3">非管理峰值 MB</th>
            <th className="pb-1 pr-3">可用 MB</th>
            <th className="pb-1 pr-3">利用率 %</th>
            <th className="pb-1 pr-3">显存利用率 %</th>
            <th className="pb-1 pr-3">独占</th>
            <th className="pb-1">候选</th>
          </tr>
        </thead>
        <tbody>
          {ledgers.map((g: Record<string, unknown>, i: number) => (
            <tr key={i} className="border-b border-dark-border/30">
              <td className="py-1 pr-3 font-mono">{String(g.gpu_index ?? i)}</td>
              <td className="py-1 pr-3 font-mono">{String(g.managed_reserved_mb ?? '-')}</td>
              <td className="py-1 pr-3 font-mono">{String(g.unmanaged_peak_mb ?? '-')}</td>
              <td className="py-1 pr-3 font-mono">{String(g.effective_free_mb ?? '-')}</td>
              <td className="py-1 pr-3 font-mono">{String(g.utilization_pct ?? '-')}</td>
              <td className="py-1 pr-3 font-mono">{String(g.vram_utilization_pct ?? '-')}</td>
              <td className="py-1 pr-3">{g.exclusive_owner ? String(g.exclusive_owner) : '-'}</td>
              <td className="py-1">{g.is_candidate ? '✓' : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskSummary({ data }: { data: AgentTaskAuditDetail }) {
  const { task, runtime } = data;

  return (
    <section className="rounded-lg border border-dark-border bg-dark-bg/60 p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-200">任务摘要</h2>
      <div className="grid gap-x-8 gap-y-0 md:grid-cols-2 text-sm">
        <DetailRow label="任务 ID" value={<span className="font-mono">{task.taskId}</span>} />
        <DetailRow label="状态" value={formatStatus(task.status)} />
        <DetailRow label="命令" value={task.command ?? '-'} />
        <DetailRow label="用户" value={task.user ?? '-'} />
        <DetailRow label="优先级" value={String(task.priority ?? 0)} />
        <DetailRow label="GPU 需求" value={`${task.requireGpuCount ?? 1} 卡 × ${task.requireVramMB === 0 ? '独占' : `${task.requireVramMB ?? '?'} MB`}`} />
        <DetailRow label="分配 GPU" value={task.gpuIds ? task.gpuIds.join(', ') : '-'} />
        <DetailRow label="创建时间" value={formatTimestamp(task.createdAt)} />
        <DetailRow label="开始时间" value={formatTimestamp(task.startedAt)} />
        <DetailRow label="结束时间" value={formatTimestamp(task.finishedAt)} />
        <DetailRow label="退出码" value={task.exitCode != null ? String(task.exitCode) : '-'} />
        <DetailRow label="PID" value={task.pid != null ? String(task.pid) : '-'} />
        {runtime ? (
          <>
            <DetailRow label="启动模式" value={runtime.launchMode} />
            <DetailRow label="运行阶段" value={runtime.runtimePhase} />
            <DetailRow label="终结来源" value={runtime.finalizeSource ?? '-'} />
            <DetailRow label="终结原因" value={runtime.finalizeReasonCode ?? '-'} />
          </>
        ) : null}
      </div>
    </section>
  );
}

function LifecycleTimeline({ events }: { events: AgentTaskEventRecord[] }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const isDecisionEvent = (type: string) =>
    type === 'schedule_blocked' || type === 'schedule_started';

  return (
    <section className="rounded-lg border border-dark-border bg-dark-bg/60 p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-200">生命周期时间线</h2>
      {events.length === 0 ? (
        <div className="text-sm text-slate-500">暂无事件记录。</div>
      ) : (
        <div className="space-y-0">
          {events.map((event) => {
            const details = event.details as Record<string, unknown> | null;
            const gpuLedgers = details?.gpu_ledgers;
            const isExpanded = expandedId === event.id;

            return (
              <div key={event.id} className="border-l-2 border-dark-border pl-4 pb-4 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-dark-border bg-dark-bg px-2 py-0.5 text-[11px] font-medium text-slate-200">
                    {formatEventType(event.eventType)}
                  </span>
                  <span className="text-xs text-slate-500">{formatTimestamp(event.timestamp)}</span>
                  {details ? (
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : event.id)}
                      className="text-xs text-slate-500 hover:text-slate-300"
                    >
                      {isExpanded ? '收起' : '详情'}
                    </button>
                  ) : null}
                </div>
                {isExpanded ? (
                  <div>
                    {isDecisionEvent(event.eventType) && gpuLedgers ? (
                      <GpuLedgerTable ledgers={gpuLedgers} />
                    ) : null}
                    <EventDetails details={details} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function TerminalFacts({ data }: { data: AgentTaskAuditDetail }) {
  const { runtime, events } = data;
  let finalizedEvent: AgentTaskEventRecord | undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].eventType === 'finalized') { finalizedEvent = events[i]; break; }
  }
  const finalDetails = finalizedEvent?.details as Record<string, unknown> | null;

  if (!runtime && !finalDetails) return null;

  return (
    <section className="rounded-lg border border-dark-border bg-dark-bg/60 p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-200">终态事实</h2>
      <div className="grid gap-x-8 gap-y-0 md:grid-cols-2 text-sm">
        {runtime ? (
          <>
            <DetailRow label="终结来源" value={runtime.finalizeSource ?? '未记录'} />
            <DetailRow label="终结原因" value={runtime.finalizeReasonCode ?? '未记录'} />
            <DetailRow label="最后退出码" value={runtime.lastObservedExitCode != null ? String(runtime.lastObservedExitCode) : '未记录'} />
          </>
        ) : null}
        {finalDetails ? (
          <>
            <DetailRow label="最后 PID" value={finalDetails.last_pid != null ? String(finalDetails.last_pid) : '未记录'} />
            <DetailRow label="最后 GPU" value={Array.isArray(finalDetails.last_gpu_ids) ? finalDetails.last_gpu_ids.join(', ') : '未记录'} />
          </>
        ) : null}
        {events.some((e) => e.eventType === 'runtime_orphan_detected') ? (
          <DetailRow label="孤儿检测" value="是" />
        ) : null}
        {events.some((e) => e.eventType === 'daemon_restart') ? (
          <DetailRow label="守护进程重启" value="是" />
        ) : null}
      </div>
    </section>
  );
}

export function TaskAuditDetail() {
  const { serverId, taskId } = useParams<{ serverId: string; taskId: string }>();
  const transport = useTransport();
  const [state, setState] = useState<LoadState>('loading');
  const [data, setData] = useState<AgentTaskAuditDetail | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!serverId || !taskId) {
      setState('error');
      setErrorMsg('缺少参数。');
      return;
    }

    if (typeof transport.getTaskAuditDetail !== 'function') {
      setState('error');
      setErrorMsg('当前传输层不支持审计查询。');
      return;
    }

    let cancelled = false;
    setState('loading');

    transport.getTaskAuditDetail(serverId, taskId)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setState('error');
          setErrorMsg('未找到任务数据，节点可能离线或任务不存在。');
          return;
        }
        setData(result);
        setState('loaded');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState('error');
        setErrorMsg(err instanceof Error ? err.message : '数据加载失败。');
      });

    return () => { cancelled = true; };
  }, [serverId, taskId, transport]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/tasks" className="text-sm text-slate-400 hover:text-slate-200">← 返回任务列表</Link>
        <h1 className="text-2xl font-bold text-slate-100">任务审计</h1>
      </div>

      {state === 'loading' ? (
        <div className="rounded-lg border border-dark-border bg-dark-card p-6 text-sm text-slate-500">
          正在加载审计数据...
        </div>
      ) : state === 'error' ? (
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-6 text-sm text-rose-300">
          {errorMsg}
        </div>
      ) : data ? (
        <>
          <TaskSummary data={data} />
          <LifecycleTimeline events={data.events} />
          <TerminalFacts data={data} />
        </>
      ) : null}
    </div>
  );
}
