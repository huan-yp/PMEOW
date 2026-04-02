import type { MetricsSnapshot, AlertEvent, AlertRecord, AppSettings, ServerConfig } from './types.js';
import { saveAlert, getActiveSuppressions } from './db/alerts.js';
import crypto from 'crypto';

// Debounce: same server + same metric won't alert again within 60s
const lastAlerted = new Map<string, number>();
const DEBOUNCE_MS = 60_000;

export type AlertCallback = (alert: AlertEvent) => void;

let alertCallback: AlertCallback = () => {};

export function setAlertCallback(cb: AlertCallback): void {
  alertCallback = cb;
}

export function checkAlerts(metrics: MetricsSnapshot, settings: AppSettings, server: ServerConfig): void {
  const checks: { metric: string; value: number; threshold: number }[] = [
    { metric: 'CPU', value: metrics.cpu.usagePercent, threshold: settings.alertCpuThreshold },
    { metric: 'Memory', value: metrics.memory.usagePercent, threshold: settings.alertMemoryThreshold },
  ];

  // Only check configured mount points (default ["/"])
  const mountPoints = settings.alertDiskMountPoints ?? ['/'];
  for (const disk of metrics.disk.disks) {
    if (mountPoints.includes(disk.mountPoint)) {
      checks.push({
        metric: `Disk(${disk.mountPoint})`,
        value: disk.usagePercent,
        threshold: settings.alertDiskThreshold,
      });
    }
  }

  // Load active suppressions
  let suppressions: Map<string, number>;
  try {
    suppressions = getActiveSuppressions();
  } catch {
    suppressions = new Map();
  }

  const now = Date.now();
  for (const check of checks) {
    if (check.value >= check.threshold) {
      const key = `${metrics.serverId}:${check.metric}`;

      // Skip if suppressed
      const suppressedUntil = suppressions.get(key);
      if (suppressedUntil && suppressedUntil > now) continue;

      // Debounce
      const last = lastAlerted.get(key);
      if (last && now - last < DEBOUNCE_MS) continue;

      lastAlerted.set(key, now);

      // Persist to DB
      const record: AlertRecord = {
        id: crypto.randomUUID(),
        serverId: metrics.serverId,
        serverName: server.name,
        metric: check.metric,
        value: check.value,
        threshold: check.threshold,
        timestamp: now,
        suppressedUntil: null,
      };

      const alertEvent: AlertEvent = {
        id: record.id,
        serverId: metrics.serverId,
        serverName: server.name,
        metric: check.metric,
        value: check.value,
        threshold: check.threshold,
        timestamp: now,
      };
      try {
        saveAlert(record);
      } catch {
        // DB write failure should not break alerting
      }

      alertCallback(alertEvent);
    }
  }
}
