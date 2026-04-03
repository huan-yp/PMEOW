import { useEffect } from 'react';
import { useTransport } from '../transport/TransportProvider.js';
import { useStore } from '../store/useStore.js';

export function useMetricsSubscription() {
  const transport = useTransport();
  const setLatestMetrics = useStore((state) => state.setLatestMetrics);
  const setStatus = useStore((state) => state.setStatus);
  const addToast = useStore((state) => state.addToast);

  useEffect(() => {
    const unsubs = [
      transport.onMetricsUpdate((data) => {
        setLatestMetrics(data);
      }),
      transport.onServerStatus((status) => {
        setStatus(status);
        if (status.latestMetrics) {
          setLatestMetrics(status.latestMetrics);
        }
      }),
      transport.onAlert((alert) => {
        addToast(
          `${alert.serverName} 告警`,
          `${alert.metric} 使用率 ${alert.value.toFixed(1)}% 超过阈值 ${alert.threshold}%`,
          'warning',
          alert.id ? {
            alertId: alert.id,
            onAction: () => { transport.suppressAlert(alert.id!, 7); },
          } : undefined
        );
      }),
      transport.onHookTriggered((log) => {
        addToast(
          '钩子触发',
          log.success ? `执行成功: ${log.result}` : `执行失败: ${log.error}`,
          log.success ? 'info' : 'error'
        );
      }),
      transport.onNotify((title, body) => {
        addToast(title, body, 'info');
      }),
    ];

    return () => unsubs.forEach(fn => fn());
  }, [transport, setLatestMetrics, setStatus, addToast]);
}

export function useLoadInitialData() {
  const transport = useTransport();
  const setServers = useStore((state) => state.setServers);
  const setStatuses = useStore((state) => state.setStatuses);
  const setHooks = useStore((state) => state.setHooks);
  const setSettings = useStore((state) => state.setSettings);

  useEffect(() => {
    async function load() {
      const [servers, statuses, hooks, settings] = await Promise.all([
        transport.getServers(),
        transport.getServerStatuses(),
        transport.getHooks(),
        transport.getSettings(),
      ]);
      setServers(servers);
      setStatuses(statuses);
      setHooks(hooks);
      setSettings(settings);

      const latestByServerId = new Map(
        statuses
          .filter((status) => status.latestMetrics !== undefined)
          .map((status) => [status.serverId, status.latestMetrics!]),
      );
      const latestResults = await Promise.allSettled(
        servers.map(async (server) => ({
          serverId: server.id,
          snapshot: await transport.getLatestMetrics(server.id),
        })),
      );

      for (const result of latestResults) {
        if (result.status !== 'fulfilled' || result.value.snapshot === null) {
          continue;
        }

        const currentSnapshot = latestByServerId.get(result.value.serverId);
        if (!currentSnapshot || result.value.snapshot.timestamp >= currentSnapshot.timestamp) {
          latestByServerId.set(result.value.serverId, result.value.snapshot);
        }
      }

      useStore.setState((state) => {
        const nextLatestMetrics = new Map(state.latestMetrics);
        latestByServerId.forEach((snapshot, serverId) => {
          nextLatestMetrics.set(serverId, snapshot);
        });

        return {
          latestMetrics: nextLatestMetrics,
        };
      });
    }
    load().catch(() => undefined);
  }, [transport, setServers, setStatuses, setHooks, setSettings]);
}
