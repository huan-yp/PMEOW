import { UnifiedReport, AppSettings, AlertRecord, AlertType } from '../types.js';
import * as alertDb from '../db/alerts.js';
import { AgentSessionRegistry } from '../node/registry.js';

interface AlertCandidate {
  alertType: AlertType;
  value: number;
  threshold: number;
  fingerprint?: string;
  details?: Record<string, unknown> | null;
}

function makeAlertKey(serverId: string, alertType: AlertType, fingerprint = ''): string {
  return `${serverId}:${alertType}:${fingerprint}`;
}

export class ThresholdAlertTracker {
  private activeKeys = new Set<string>();

  check(serverId: string, report: UnifiedReport, settings: AppSettings): AlertRecord[] {
    const alerts: AlertRecord[] = [];
    const activeKeysForReport = new Set<string>();
    const candidates = collectAlertCandidates(report, settings);

    for (const candidate of candidates) {
      const fingerprint = candidate.fingerprint ?? '';
      const key = makeAlertKey(serverId, candidate.alertType, fingerprint);
      activeKeysForReport.add(key);

      if (this.activeKeys.has(key)) {
        continue;
      }

      alerts.push(alertDb.upsertAlert(
        serverId,
        candidate.alertType,
        candidate.value,
        candidate.threshold,
        fingerprint,
        candidate.details ?? null,
      ));
    }

    for (const key of [...this.activeKeys]) {
      if (key.startsWith(`${serverId}:`) && !activeKeysForReport.has(key)) {
        this.activeKeys.delete(key);
      }
    }

    for (const key of activeKeysForReport) {
      this.activeKeys.add(key);
    }

    const now = Date.now();
    return alerts.filter((alert) => !alert.suppressedUntil || alert.suppressedUntil < now);
  }
}

function collectAlertCandidates(report: UnifiedReport, settings: AppSettings): AlertCandidate[] {
  const alerts: AlertCandidate[] = [];
  const { resourceSnapshot } = report;

  if (resourceSnapshot.cpu.usagePercent >= settings.alertCpuThreshold) {
    alerts.push({
      alertType: 'cpu',
      value: resourceSnapshot.cpu.usagePercent,
      threshold: settings.alertCpuThreshold,
    });
  }

  if (resourceSnapshot.memory.usagePercent >= settings.alertMemoryThreshold) {
    alerts.push({
      alertType: 'memory',
      value: resourceSnapshot.memory.usagePercent,
      threshold: settings.alertMemoryThreshold,
    });
  }

  for (const disk of resourceSnapshot.disks) {
    if (!settings.alertDiskMountPoints.includes(disk.mountPoint)) {
      continue;
    }
    if (disk.usagePercent >= settings.alertDiskThreshold) {
      alerts.push({
        alertType: 'disk',
        value: disk.usagePercent,
        threshold: settings.alertDiskThreshold,
        fingerprint: disk.mountPoint,
        details: { mountPoint: disk.mountPoint, filesystem: disk.filesystem },
      });
    }
  }

  for (const gpu of resourceSnapshot.gpuCards) {
    if (gpu.temperature >= settings.alertGpuTempThreshold) {
      alerts.push({
        alertType: 'gpu_temp',
        value: gpu.temperature,
        threshold: settings.alertGpuTempThreshold,
        fingerprint: `gpu${gpu.index}`,
        details: { gpuIndex: gpu.index, gpuName: gpu.name },
      });
    }
  }

  return alerts;
}

export function checkOffline(registry: AgentSessionRegistry, settings: AppSettings, now = Date.now()): AlertRecord[] {
  const alerts: AlertRecord[] = [];
  const sessions = registry.getAllSessions();
  
  for (const session of sessions) {
    const lastReport = registry.getLastReportAt(session.agentId) || 0;
    if (now - lastReport > settings.alertOfflineSeconds * 1000) {
      alerts.push(alertDb.upsertAlert(session.serverId, 'offline', (now - lastReport) / 1000, settings.alertOfflineSeconds));
    }
  }

  const currentNow = Date.now();
  return alerts.filter(a => !a.suppressedUntil || a.suppressedUntil < currentNow);
}
