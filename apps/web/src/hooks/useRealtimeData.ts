import { useEffect, useCallback } from 'react';
import { useTransport } from '../transport/TransportProvider.js';
import { useStore } from '../store/useStore.js';

/**
 * Load tasks and security events on demand.
 * Unlike the old useOperatorData, there's no polling or debouncing —
 * real-time updates come via WebSocket (useMetricsSubscription handles those).
 * This hook is for initial/page-level data fetching.
 */
export function useRealtimeData() {
  const transport = useTransport();
  const setTasks = useStore((s) => s.setTasks);
  const setSecurityEvents = useStore((s) => s.setSecurityEvents);
  const setAlerts = useStore((s) => s.setAlerts);

  const refreshTasks = useCallback(
    (query?: { serverId?: string; status?: string; page?: number; limit?: number }) => {
      transport.getTasks(query)
        .then((res) => setTasks(res.tasks, res.total))
        .catch(() => undefined);
    },
    [transport, setTasks],
  );

  const refreshAlerts = useCallback(
    (query?: { serverId?: string }) => {
      transport.getAlerts(query)
        .then(setAlerts)
        .catch(() => undefined);
    },
    [transport, setAlerts],
  );

  const refreshSecurityEvents = useCallback(
    (query?: { serverId?: string; resolved?: boolean }) => {
      transport.getSecurityEvents(query)
        .then(setSecurityEvents)
        .catch(() => undefined);
    },
    [transport, setSecurityEvents],
  );

  useEffect(() => {
    refreshTasks();
    refreshAlerts();
    refreshSecurityEvents({ resolved: false });
  }, [refreshTasks, refreshAlerts, refreshSecurityEvents]);

  return { refreshTasks, refreshAlerts, refreshSecurityEvents };
}
