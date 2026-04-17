import { useEffect } from 'react';
import { useTransport } from '../transport/TransportProvider.js';
import { useStore } from '../store/useStore.js';

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
        upsertTask(event.task);
        const labels: Record<string, string> = {
          submitted: '任务提交',
          started: '任务启动',
          ended: '任务结束',
          priority_changed: '优先级变更',
        };
        addToast(labels[event.eventType] ?? '任务事件', `${event.task.command}`, 'info');
      }),

      transport.onAlert((alert) => {
        addToast(
          `告警: ${alert.alertType}`,
          `节点 ${alert.serverId} — ${alert.alertType} ${alert.value} 超过阈值 ${alert.threshold}`,
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

export function useLoadInitialData() {
  const transport = useTransport();
  const setServers = useStore((s) => s.setServers);
  const setStatuses = useStore((s) => s.setStatuses);

  useEffect(() => {
    async function load() {
      const [servers, statuses] = await Promise.all([
        transport.getServers(),
        transport.getStatuses(),
      ]);
      setServers(servers);
      setStatuses(statuses);
    }
    load().catch(() => undefined);
  }, [transport, setServers, setStatuses]);
}
