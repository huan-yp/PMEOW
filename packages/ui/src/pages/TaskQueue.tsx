import { useRef, useState } from 'react';
import type { MirroredAgentTaskRecord } from '@monitor/core';
import { useTransport } from '../transport/TransportProvider.js';
import { useStore } from '../store/useStore.js';

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

function TaskSection({
  title,
  tasks,
  busyTaskKeys,
  onCancel,
  onRaisePriority,
}: {
  title: string;
  tasks: MirroredAgentTaskRecord[];
  busyTaskKeys: string[];
  onCancel: (task: MirroredAgentTaskRecord) => void;
  onRaisePriority: (task: MirroredAgentTaskRecord) => void;
}) {
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
              {tasks.map((task) => {
                const taskBusy = busyTaskKeys.includes(getTaskBusyKey(task));
                const canCancel = task.status === 'queued' || task.status === 'running';
                const canRaisePriority = task.status === 'queued';

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
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function TaskQueue() {
  const transport = useTransport();
  const taskQueueGroups = useStore((state) => state.taskQueueGroups);
  const [busyServerIds, setBusyServerIds] = useState<string[]>([]);
  const [busyTaskKeys, setBusyTaskKeys] = useState<string[]>([]);
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
        taskQueueGroups.map((group) => (
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

            <div className="mt-4 grid gap-4 xl:grid-cols-3">
              <TaskSection
                title="排队中"
                tasks={group.queued}
                busyTaskKeys={busyTaskKeys}
                onCancel={handleCancelTask}
                onRaisePriority={handleRaisePriority}
              />
              <TaskSection
                title="运行中"
                tasks={group.running}
                busyTaskKeys={busyTaskKeys}
                onCancel={handleCancelTask}
                onRaisePriority={handleRaisePriority}
              />
              <TaskSection
                title="最近完成"
                tasks={group.recent}
                busyTaskKeys={busyTaskKeys}
                onCancel={handleCancelTask}
                onRaisePriority={handleRaisePriority}
              />
            </div>
          </section>
        ))
      )}
    </div>
  );
}