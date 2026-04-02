import { useEffect } from 'react';
import { useTransport } from '../transport/TransportProvider.js';
import { useStore } from '../store/useStore.js';

export function useMetricsSubscription() {
  const transport = useTransport();
  const { setLatestMetrics, setStatus, addToast } = useStore();

  useEffect(() => {
    const unsubs = [
      transport.onMetricsUpdate((data) => {
        setLatestMetrics(data);
      }),
      transport.onServerStatus((status) => {
        setStatus(status);
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
  const { setServers, setStatuses, setHooks, setSettings } = useStore();

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
    }
    load();
  }, [transport, setServers, setStatuses, setHooks, setSettings]);
}
