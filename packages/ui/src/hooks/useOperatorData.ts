import { useEffect, useRef } from 'react';
import { useTransport } from '../transport/TransportProvider.js';
import { useStore } from '../store/useStore.js';

const DEFAULT_SECURITY_LOOKBACK_HOURS = 168;
const DEFAULT_REFRESH_DEBOUNCE_MS = 150;

export function useOperatorBootstrap() {
  const transport = useTransport();
  const setTaskQueueGroups = useStore((state) => state.setTaskQueueGroups);
  const setOpenSecurityEvents = useStore((state) => state.setOpenSecurityEvents);
  const taskQueueRefreshTimerRef = useRef<number | null>(null);
  const securityEventsRefreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let taskQueueRequestId = 0;
    let securityEventsRequestId = 0;

    const loadTaskQueue = async () => {
      const requestId = ++taskQueueRequestId;

      try {
        const taskQueueGroups = await transport.getTaskQueue();

        if (cancelled || requestId !== taskQueueRequestId) {
          return;
        }

        setTaskQueueGroups(taskQueueGroups);
      } catch {
        return;
      }
    };

    const loadSecurityEvents = async () => {
      const requestId = ++securityEventsRequestId;

      try {
        const openSecurityEvents = await transport.getSecurityEvents({ resolved: false, hours: DEFAULT_SECURITY_LOOKBACK_HOURS });

        if (cancelled || requestId !== securityEventsRequestId) {
          return;
        }

        setOpenSecurityEvents(openSecurityEvents);
      } catch {
        return;
      }
    };

    const load = async () => {
      await Promise.all([loadTaskQueue(), loadSecurityEvents()]);
    };

    const scheduleTaskQueueRefresh = () => {
      if (taskQueueRefreshTimerRef.current !== null) {
        window.clearTimeout(taskQueueRefreshTimerRef.current);
      }

      taskQueueRefreshTimerRef.current = window.setTimeout(() => {
        taskQueueRefreshTimerRef.current = null;
        void loadTaskQueue();
      }, DEFAULT_REFRESH_DEBOUNCE_MS);
    };

    const scheduleSecurityEventsRefresh = () => {
      if (securityEventsRefreshTimerRef.current !== null) {
        window.clearTimeout(securityEventsRefreshTimerRef.current);
      }

      securityEventsRefreshTimerRef.current = window.setTimeout(() => {
        securityEventsRefreshTimerRef.current = null;
        void loadSecurityEvents();
      }, DEFAULT_REFRESH_DEBOUNCE_MS);
    };

    void load();

    const unsubscribeTaskUpdate = transport.onTaskUpdate(() => {
      scheduleTaskQueueRefresh();
    });
    const unsubscribeSecurityEvent = transport.onSecurityEvent(() => {
      scheduleSecurityEventsRefresh();
    });

    return () => {
      cancelled = true;
      if (taskQueueRefreshTimerRef.current !== null) {
        window.clearTimeout(taskQueueRefreshTimerRef.current);
        taskQueueRefreshTimerRef.current = null;
      }
      if (securityEventsRefreshTimerRef.current !== null) {
        window.clearTimeout(securityEventsRefreshTimerRef.current);
        securityEventsRefreshTimerRef.current = null;
      }
      unsubscribeTaskUpdate();
      unsubscribeSecurityEvent();
    };
  }, [transport, setOpenSecurityEvents, setTaskQueueGroups]);
}