import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { MirroredAgentTaskRecord } from '@monitor/core';
import { useTransport } from '../transport/TransportProvider.js';
import { useStore } from '../store/useStore.js';

const RECENT_TASKS_PAGE_SIZE = 5;

type TabKey = 'queued' | 'running' | 'recent';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'queued', label: '排队中' },
  { key: 'running', label: '运行中' },
  { key: 'recent', label: '最近完成' },
];

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

function TaskTable({
  tasks,
  busyTaskKeys,
  onCancel,
  onRaisePriority,
  pagination,
}: {
  tasks: MirroredAgentTaskRecord[];
  busyTaskKeys: string[];
  onCancel: (task: MirroredAgentTaskRecord) => void;
  onRaisePriority: (task: MirroredAgentTaskRecord) => void;
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

  if (tasks.length === 0) {
    return <div className="py-6 text-center text-sm text-slate-500">暂无任务</div>;
  }

  return (
    <>
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

              return (
                <tr key={task.taskId} className="border-b border-dark-border/50 last:border-b-0">
                  <td className="py-3 pr-4 font-mono text-slate-200">{task.taskId}</td>
                  <td className="py-3 pr-4 text-slate-300">{task.command ?? '-'}</td>
                  <td className="py-3 pr-4 text-slate-400">{task.user ?? '-'}</td>
                  <td className="py-3 pr-4 text-slate-300">{task.priority ?? 0}</td>
                  <td className="py-3 pr-4 text-slate-400">{formatTaskStatus(task.status)}</td>
                  <td className="py-3">
                    <div className="flex flex-wrap gap-2">
                      <Link
                        to={`/tasks/${task.serverId}/${task.taskId}`}
                        className="rounded border border-dark-border px-2 py-1 text-xs text-slate-300 transition-colors hover:bg-dark-hover"
                      >
                        审计详情
                      </Link>
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
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
    </>
  );
}

export function TaskQueue() {
  const transport = useTransport();
  const taskQueueGroups = useStore((state) => state.taskQueueGroups);
  const [busyServerIds, setBusyServerIds] = useState<string[]>([]);
  const [busyTaskKeys, setBusyTaskKeys] = useState<string[]>([]);
  const [activeTabByServerId, setActiveTabByServerId] = useState<Record<string, TabKey>>({});
  const [recentPagesByServerId, setRecentPagesByServerId] = useState<Record<string, number>>({});
  const busyServerIdsRef = useRef(new Set<string>());
  const busyTaskKeysRef = useRef(new Set<string>());

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
          const activeTab = activeTabByServerId[group.serverId] ?? 'queued';
          const recentPageCount = Math.max(1, Math.ceil(group.recent.length / RECENT_TASKS_PAGE_SIZE));
          const currentRecentPage = Math.min(
            Math.max(recentPagesByServerId[group.serverId] ?? 1, 1),
            recentPageCount,
          );

          const tabTasks: Record<TabKey, MirroredAgentTaskRecord[]> = {
            queued: group.queued,
            running: group.running,
            recent: group.recent,
          };

          const tabCounts: Record<TabKey, number> = {
            queued: group.queued.length,
            running: group.running.length,
            recent: group.recent.length,
          };

          return (
            <section key={group.serverId} className="rounded-lg border border-dark-border bg-dark-card p-4 shadow-sm">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-100">{group.serverName}</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    节点 ID {group.serverId} · 排队 {group.queued.length} · 运行 {group.running.length} · 最近 {group.recent.length}
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

              <div className="mt-4">
                <div className="flex border-b border-dark-border">
                  {TABS.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveTabByServerId((current) => ({ ...current, [group.serverId]: tab.key }))}
                      className={`px-4 py-2 text-sm font-medium transition-colors ${
                        activeTab === tab.key
                          ? 'border-b-2 border-blue-400 text-blue-300'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {tab.label}
                      <span className="ml-1.5 text-xs text-slate-500">({tabCounts[tab.key]})</span>
                    </button>
                  ))}
                </div>

                <div className="mt-4">
                  <TaskTable
                    tasks={tabTasks[activeTab]}
                    busyTaskKeys={busyTaskKeys}
                    onCancel={handleCancelTask}
                    onRaisePriority={handleRaisePriority}
                    pagination={activeTab === 'recent' ? {
                      page: currentRecentPage,
                      pageSize: RECENT_TASKS_PAGE_SIZE,
                      onPreviousPage: () => handleRecentPageChange(group.serverId, currentRecentPage - 1),
                      onNextPage: () => handleRecentPageChange(group.serverId, currentRecentPage + 1),
                    } : undefined}
                  />
                </div>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
