import { useEffect } from 'react';
import { useTransport } from '../transport/TransportProvider.js';
import { useStore } from '../store/useStore.js';
import type { Task, TaskInfo } from '../transport/types.js';

const ALERT_TYPE_LABELS: Record<string, string> = {
  cpu: 'CPU 过高',
  memory: '内存过高',
  disk: '磁盘过高',
  gpu_temp: 'GPU 温度',
  offline: '节点离线',
  gpu_idle_memory: 'GPU 显存空占',
};

function formatAlertNumber(value: number | null): string {
  if (value == null) {
    return '—';
  }

  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function formatAlertWithUnit(alertType: string, value: number | null): string {
  if (value == null) {
    return '—';
  }

  switch (alertType) {
    case 'gpu_temp':
      return `${formatAlertNumber(value)}°C`;
    case 'offline':
      return `${formatAlertNumber(value)}秒`;
    default:
      return `${formatAlertNumber(value)}%`;
  }
}

function formatAlertToast(alertType: string, value: number | null, threshold: number | null): string {
  const label = ALERT_TYPE_LABELS[alertType] ?? alertType;

  if (alertType === 'offline') {
    return `${label} ${formatAlertWithUnit(alertType, value)}，超出离线阈值 ${formatAlertWithUnit(alertType, threshold)}`;
  }

  return `${label} ${formatAlertWithUnit(alertType, value)}，超过阈值 ${formatAlertWithUnit(alertType, threshold)}`;
}

export function useMetricsSubscription() {
  const transport = useTransport();
  const setServers = useStore((s) => s.setServers);
  const setLatestSnapshot = useStore((s) => s.setLatestSnapshot);
  const setStatus = useStore((s) => s.setStatus);
  const upsertTask = useStore((s) => s.upsertTask);
  const addToast = useStore((s) => s.addToast);

  useEffect(() => {
    let refreshingServers = false;

    const refreshServers = () => {
      if (refreshingServers) return;
      refreshingServers = true;
      transport.getServers()
        .then(setServers)
        .catch(() => undefined)
        .finally(() => { refreshingServers = false; });
    };

    const unsubs = [
      transport.onMetricsUpdate((data) => {
        setLatestSnapshot(data.serverId, data.snapshot);
      }),

      transport.onServerStatus((status) => {
        setStatus(status);
        if (!useStore.getState().servers.some((srv) => srv.id === status.serverId)) {
          refreshServers();
        }
      }),

      transport.onTaskEvent((event) => {
        upsertTask(toTaskRecord(event.task, event.serverId));
        const labels: Record<string, string> = {
          submitted: '任务提交',
          started: '任务启动',
          ended: '任务结束',
          priority_changed: '优先级变更',
        };
        const title = labels[event.eventType];
        if (!title) {
          return;
        }
        addToast(title, `${event.task.command}`, 'info');
      }),

      transport.onAlert((alert) => {
        const srv = useStore.getState().servers.find((s) => s.id === alert.serverId);
        const nodeName = srv?.name ?? alert.serverId;
        addToast(
          `告警: ${ALERT_TYPE_LABELS[alert.alertType] ?? alert.alertType}`,
          `节点 ${nodeName} - ${formatAlertToast(alert.alertType, alert.value, alert.threshold)}`,
          'warning',
        );
      }),

      transport.onSecurityEvent((event) => {
        useStore.setState((s) => ({
          securityEvents: [event, ...s.securityEvents.filter((e) => e.id !== event.id)],
        }));
        addToast('安全事件', `${event.eventType}: ${event.fingerprint}`, 'error');
      }),

      transport.onServersChanged(() => {
        refreshServers();
      }),
    ];

    return () => unsubs.forEach((fn) => fn());
  }, [transport, setServers, setLatestSnapshot, setStatus, upsertTask, addToast]);
}

function toTaskRecord(task: TaskInfo, serverId: string): Task {
  return {
    id: task.taskId,
    serverId,
    status: task.status,
    command: task.command,
    cwd: task.cwd,
    user: task.user,
    launchMode: task.launchMode,
    requireVramMb: task.requireVramMb,
    requireGpuCount: task.requireGpuCount,
    gpuIds: task.gpuIds,
    priority: task.priority,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt ?? null,
    pid: task.pid,
    exitCode: task.exitCode ?? null,
    assignedGpus: task.assignedGpus,
    declaredVramPerGpu: task.declaredVramPerGpu,
    scheduleHistory: task.scheduleHistory,
    endReason: task.endReason ?? null,
  };
}

export function useLoadInitialData() {
  const transport = useTransport();
  const setServers = useStore((s) => s.setServers);
  const setStatuses = useStore((s) => s.setStatuses);
  const setLatestSnapshots = useStore((s) => s.setLatestSnapshots);

  useEffect(() => {
    async function load() {
      const [servers, statuses, latestMetrics] = await Promise.all([
        transport.getServers(),
        transport.getStatuses(),
        transport.getLatestMetrics(),
      ]);
      setServers(servers);
      setStatuses(statuses);
      setLatestSnapshots(latestMetrics);
    }
    load().catch(() => undefined);
  }, [transport, setServers, setStatuses, setLatestSnapshots]);
}
