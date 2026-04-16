import { useRef, useState } from 'react';
import type { AgentTaskEventRecord, MirroredAgentTaskRecord } from '@monitor/core';
import { useTransport } from '../transport/TransportProvider.js';
import { useStore } from '../store/useStore.js';

const RECENT_TASKS_PAGE_SIZE = 5;

function getTaskBusyKey(task: MirroredAgentTaskRecord) {
  return `${task.serverId}:${task.taskId}`;
}

function formatTaskStatus(status: MirroredAgentTaskRecord['status']) {
  switch (status) {
    case 'queued':
      return '排队中';
    case 'running':
      return '运行中';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
    default:
      return status;
  }
}

function formatReasonLabel(reasonCode: unknown) {
  switch (reasonCode) {
    case 'queue_paused':
      return '队列已暂停';
    case 'blocked_by_higher_priority':
      return '被更高优先级任务占用';
    case 'insufficient_gpu_count':
      return '当前可用 GPU 数不足';
    case 'sustained_window_not_satisfied':
      return '持续窗口不满足';
    default:
      return '等待调度';
  }
}

function formatEventTimestamp(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString('zh-CN', { hour12: false });
}

function isStructuredDetails(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatList(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    return '无';
  }

  return value.join(', ');
}

function extractLatestSchedulingEvent(events: AgentTaskEventRecord[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.eventType === 'schedule_blocked' || event.eventType === 'queue_paused') {
      return event;
    }
  }

  return null;
}

function SchedulingReasonPanel({ event }: { event: AgentTaskEventRecord | null }) {
  if (!event) {
    return <div className="mt-2 text-xs text-slate-500">暂未收到结构化调度原因。</div>;
  }

  const details = isStructuredDetails(event.details) ? event.details : {};
  const message = typeof details.message === 'string' ? details.message : '';

  return (
    <div className="mt-3 rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-slate-300">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11px] font-medium text-amber-200">
          {formatReasonLabel(details.reason_code)}
        </span>
        <span className="text-slate-500">{formatEventTimestamp(event.timestamp)}</span>
      </div>
      {message ? <p className="mt-2 break-words text-slate-300">{message}</p> : null}
      <div className="mt-2 grid gap-2 md:grid-cols-3">
        <div>
          <div className="text-slate-500">当前候选 GPU</div>
          <div className="mt-1 font-mono text-slate-300">{formatList(details.current_eligible_gpu_ids)}</div>
        </div>
        <div>
          <div className="text-slate-500">持续窗口交集</div>
          <div className="mt-1 font-mono text-slate-300">{formatList(details.sustained_eligible_gpu_ids)}</div>
        </div>
        <div>
          <div className="text-slate-500">阻塞任务</div>
          <div className="mt-1 font-mono text-slate-300">{formatList(details.blocker_task_ids)}</div>
        </div>
      </div>
    </div>
  );
}

function TaskSection({
  title,
  tasks,
  busyTaskKeys,
  expandedTaskKey,
  loadingReasonTaskKeys,
  reasonEventsByTaskKey,
  reasonErrorsByTaskKey,
  onCancel,
  onRaisePriority,
  onToggleReason,
  pagination,
}: {
  title: string;
  tasks: MirroredAgentTaskRecord[];
  busyTaskKeys: string[];
  expandedTaskKey: string | null;
  loadingReasonTaskKeys: string[];
  reasonEventsByTaskKey: Record<string, AgentTaskEventRecord[]>;
  reasonErrorsByTaskKey: Record<string, string>;
  onCancel: (task: MirroredAgentTaskRecord) => void;
  onRaisePriority: (task: MirroredAgentTaskRecord) => void;
  onToggleReason: (task: MirroredAgentTaskRecord) => void;
  pagination?: {
    page: number;
    pageSize: number;
    onPreviousPage: () => void;
    onNextPage: () => void;
  };
}) {
  const pageSize = pagination?.pageSize ?? (tasks.length || 1);
  const pageCount = Math.max(1, Math.ceil(tasks.length / pageSize));
  const currentPage = Math.min(Math.max(pagination?.page ?? 1, 1), pageCount);
  const visibleTasks = pagination
    ? tasks.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    : tasks;
  const showPagination = Boolean(pagination) && tasks.length > pageSize;

  return (
    <section className="rounded-lg border border-dark-border bg-dark-bg/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
        <span className="text-xs text-slate-500">{tasks.length} 项</span>
      </div>

      {tasks.length === 0 ? (
        <div className="text-sm text-slate-500">暂无任务</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-border text-left text-xs text-slate-500">
                <th className="pb-2 pr-4">任务 ID</th>
                <th className="pb-2 pr-4">命令</th>
                <th className="pb-2 pr-4">用户</th>
                <th className="pb-2 pr-4">优先级</th>
                <th className="pb-2 pr-4">状态</th>
                <th className="pb-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleTasks.map((task) => {
                const taskKey = getTaskBusyKey(task);
                const taskBusy = busyTaskKeys.includes(taskKey);
                const canCancel = task.status === 'queued' || task.status === 'running';
                const canRaisePriority = task.status === 'queued';
                const canViewReason = task.status === 'queued';
                const isExpanded = expandedTaskKey === taskKey;
                const isLoadingReason = loadingReasonTaskKeys.includes(taskKey);
                const reasonError = reasonErrorsByTaskKey[taskKey];
                const latestSchedulingEvent = extractLatestSchedulingEvent(reasonEventsByTaskKey[taskKey] ?? []);

                return (
                  <tr key={task.taskId} className="border-b border-dark-border/50 align-top last:border-b-0">
                    <td className="py-3 pr-4 font-mono text-slate-200">{task.taskId}</td>
                    <td className="py-3 pr-4 text-slate-300">{task.command ?? '-'}</td>
                    <td className="py-3 pr-4 text-slate-400">{task.user ?? '-'}</td>
                    <td className="py-3 pr-4 text-slate-300">{task.priority ?? 0}</td>
                    <td className="py-3 pr-4 text-slate-400">{formatTaskStatus(task.status)}</td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-2">
                        {canCancel ? (
                          <button
                            type="button"
                            aria-label={`取消任务 ${task.taskId}`}
                            onClick={() => onCancel(task)}
                            disabled={taskBusy}
                            className="rounded border border-dark-border px-2 py-1 text-xs text-slate-300 transition-colors hover:bg-dark-hover disabled:opacity-50"
                          >
                            取消任务
                          </button>
                        ) : null}
                        {canRaisePriority ? (
                          <button
                            type="button"
                            aria-label={`提高优先级 ${task.taskId}`}
                            onClick={() => onRaisePriority(task)}
                            disabled={taskBusy}
                            className="rounded border border-dark-border px-2 py-1 text-xs text-slate-300 transition-colors hover:bg-dark-hover disabled:opacity-50"
                          >
                            提高优先级
                          </button>
                        ) : null}
                        {canViewReason ? (
                          <button
                            type="button"
                            aria-label={`查看调度原因 ${task.taskId}`}
                            onClick={() => onToggleReason(task)}
                            disabled={isLoadingReason}
                            className="rounded border border-amber-500/20 px-2 py-1 text-xs text-amber-200 transition-colors hover:bg-amber-500/10 disabled:opacity-50"
                          >
                            {isExpanded ? '收起原因' : '查看调度原因'}
                          </button>
                        ) : null}
                      </div>
                      {isExpanded ? (
                        reasonError ? (
                          <div className="mt-2 text-xs text-rose-300">{reasonError}</div>
                        ) : isLoadingReason ? (
                          <div className="mt-2 text-xs text-slate-500">正在加载调度原因...</div>
                        ) : (
                          <SchedulingReasonPanel event={latestSchedulingEvent} />
                        )
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showPagination ? (
        <div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-500">
          <span>第 {currentPage} 页 / 共 {pageCount} 页</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={pagination?.onPreviousPage}
              disabled={currentPage <= 1}
              className="rounded border border-dark-border px-3 py-1.5 text-slate-400 transition-colors hover:bg-dark-hover disabled:opacity-30"
            >
              上一页
            </button>
            <button
              type="button"
              onClick={pagination?.onNextPage}
              disabled={currentPage >= pageCount}
              className="rounded border border-dark-border px-3 py-1.5 text-slate-400 transition-colors hover:bg-dark-hover disabled:opacity-30"
            >
              下一页
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function TaskQueue() {
  const transport = useTransport();
  const taskQueueGroups = useStore((state) => state.taskQueueGroups);
  const [busyServerIds, setBusyServerIds] = useState<string[]>([]);
  const [busyTaskKeys, setBusyTaskKeys] = useState<string[]>([]);
  const [recentPagesByServerId, setRecentPagesByServerId] = useState<Record<string, number>>({});
  const [expandedTaskKey, setExpandedTaskKey] = useState<string | null>(null);
  const [loadingReasonTaskKeys, setLoadingReasonTaskKeys] = useState<string[]>([]);
  const [reasonEventsByTaskKey, setReasonEventsByTaskKey] = useState<Record<string, AgentTaskEventRecord[]>>({});
  const [reasonErrorsByTaskKey, setReasonErrorsByTaskKey] = useState<Record<string, string>>({});
  const busyServerIdsRef = useRef(new Set<string>());
  const busyTaskKeysRef = useRef(new Set<string>());
  const loadingReasonTaskKeysRef = useRef(new Set<string>());

  const runServerAction = async (serverId: string, action: () => Promise<void>) => {
    if (busyServerIdsRef.current.has(serverId)) {
      return;
    }

    busyServerIdsRef.current.add(serverId);
    setBusyServerIds((current) => current.includes(serverId) ? current : [...current, serverId]);

    try {
      await action();
    } catch {
      return;
    } finally {
      busyServerIdsRef.current.delete(serverId);
      setBusyServerIds((current) => current.filter((value) => value !== serverId));
    }
  };

  const runTaskAction = async (task: MirroredAgentTaskRecord, action: () => Promise<void>) => {
    const taskKey = getTaskBusyKey(task);

    if (busyTaskKeysRef.current.has(taskKey)) {
      return;
    }

    busyTaskKeysRef.current.add(taskKey);
    setBusyTaskKeys((current) => current.includes(taskKey) ? current : [...current, taskKey]);

    try {
      await action();
    } catch {
      return;
    } finally {
      busyTaskKeysRef.current.delete(taskKey);
      setBusyTaskKeys((current) => current.filter((value) => value !== taskKey));
    }
  };

  const handlePauseQueue = (serverId: string) => {
    void runServerAction(serverId, () => transport.pauseQueue(serverId));
  };

  const handleResumeQueue = (serverId: string) => {
    void runServerAction(serverId, () => transport.resumeQueue(serverId));
  };

  const handleRecentPageChange = (serverId: string, nextPage: number) => {
    setRecentPagesByServerId((current) => ({
      ...current,
      [serverId]: Math.max(1, nextPage),
    }));
  };

  const handleCancelTask = (task: MirroredAgentTaskRecord) => {
    void runTaskAction(task, () => transport.cancelTask(task.serverId, task.taskId));
  };

  const handleRaisePriority = (task: MirroredAgentTaskRecord) => {
    const nextPriority = (task.priority ?? 0) + 1;
    void runTaskAction(task, () => transport.setTaskPriority(task.serverId, task.taskId, nextPriority));
  };

  const handleToggleReason = (task: MirroredAgentTaskRecord) => {
    const taskKey = getTaskBusyKey(task);
    if (expandedTaskKey === taskKey) {
      setExpandedTaskKey(null);
      return;
    }

    setExpandedTaskKey(taskKey);
    setReasonErrorsByTaskKey((current) => ({ ...current, [taskKey]: '' }));

    if (reasonEventsByTaskKey[taskKey] || typeof transport.getTaskEvents !== 'function') {
      return;
    }

    if (loadingReasonTaskKeysRef.current.has(taskKey)) {
      return;
    }

    loadingReasonTaskKeysRef.current.add(taskKey);
    setLoadingReasonTaskKeys((current) => current.includes(taskKey) ? current : [...current, taskKey]);

    void transport.getTaskEvents(task.serverId, task.taskId, 0)
      .then((events) => {
        setReasonEventsByTaskKey((current) => ({ ...current, [taskKey]: events }));
      })
      .catch((error: unknown) => {
        setReasonErrorsByTaskKey((current) => ({
          ...current,
          [taskKey]: error instanceof Error ? error.message : '加载调度原因失败',
        }));
      })
      .finally(() => {
        loadingReasonTaskKeysRef.current.delete(taskKey);
        setLoadingReasonTaskKeys((current) => current.filter((value) => value !== taskKey));
      });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">任务调度</h1>
          <p className="mt-1 text-sm text-slate-500">查看节点任务队列并执行基础调度控制。</p>
        </div>
      </div>

      {taskQueueGroups.length === 0 ? (
        <div className="rounded-lg border border-dark-border bg-dark-card p-6 text-sm text-slate-500">
          暂无任务队列数据，等待节点开始上报。
        </div>
      ) : (
        taskQueueGroups.map((group) => {
          const recentPageCount = Math.max(1, Math.ceil(group.recent.length / RECENT_TASKS_PAGE_SIZE));
          const currentRecentPage = Math.min(
            Math.max(recentPagesByServerId[group.serverId] ?? 1, 1),
            recentPageCount,
          );

          return (
            <section key={group.serverId} className="rounded-lg border border-dark-border bg-dark-card p-4 shadow-sm">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-100">{group.serverName}</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    节点 ID {group.serverId} · 排队 {group.queued.length} · 运行 {group.running.length} · 最近 {group.recent.length}（最多展示 20 条）
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handlePauseQueue(group.serverId)}
                    disabled={busyServerIds.includes(group.serverId)}
                    className="rounded border border-dark-border px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-dark-hover disabled:opacity-50"
                  >
                    暂停队列
                  </button>
                  <button
                    type="button"
                    onClick={() => handleResumeQueue(group.serverId)}
                    disabled={busyServerIds.includes(group.serverId)}
                    className="rounded border border-dark-border px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-dark-hover disabled:opacity-50"
                  >
                    恢复队列
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-3">
                <TaskSection
                  title="排队中"
                  tasks={group.queued}
                  busyTaskKeys={busyTaskKeys}
                  expandedTaskKey={expandedTaskKey}
                  loadingReasonTaskKeys={loadingReasonTaskKeys}
                  reasonEventsByTaskKey={reasonEventsByTaskKey}
                  reasonErrorsByTaskKey={reasonErrorsByTaskKey}
                  onCancel={handleCancelTask}
                  onRaisePriority={handleRaisePriority}
                  onToggleReason={handleToggleReason}
                />
                <TaskSection
                  title="运行中"
                  tasks={group.running}
                  busyTaskKeys={busyTaskKeys}
                  expandedTaskKey={expandedTaskKey}
                  loadingReasonTaskKeys={loadingReasonTaskKeys}
                  reasonEventsByTaskKey={reasonEventsByTaskKey}
                  reasonErrorsByTaskKey={reasonErrorsByTaskKey}
                  onCancel={handleCancelTask}
                  onRaisePriority={handleRaisePriority}
                  onToggleReason={handleToggleReason}
                />
                <TaskSection
                  title="最近完成（最近 20 条）"
                  tasks={group.recent}
                  busyTaskKeys={busyTaskKeys}
                  expandedTaskKey={expandedTaskKey}
                  loadingReasonTaskKeys={loadingReasonTaskKeys}
                  reasonEventsByTaskKey={reasonEventsByTaskKey}
                  reasonErrorsByTaskKey={reasonErrorsByTaskKey}
                  onCancel={handleCancelTask}
                  onRaisePriority={handleRaisePriority}
                  onToggleReason={handleToggleReason}
                  pagination={{
                    page: currentRecentPage,
                    pageSize: RECENT_TASKS_PAGE_SIZE,
                    onPreviousPage: () => handleRecentPageChange(group.serverId, currentRecentPage - 1),
                    onNextPage: () => handleRecentPageChange(group.serverId, currentRecentPage + 1),
                  }}
                />
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}