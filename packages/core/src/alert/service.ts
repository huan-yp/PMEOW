import { UnifiedReport, AppSettings, AlertRecord } from '../types.js';
import * as alertDb from '../db/alerts.js';
import { AgentSessionRegistry } from '../node/registry.js';

export function checkAlerts(serverId: string, report: UnifiedReport, settings: AppSettings): AlertRecord[] {
  const alerts: AlertRecord[] = [];
  const { resourceSnapshot } = report;

  // CPU
  if (resourceSnapshot.cpu.usagePercent >= settings.alertCpuThreshold) {
    alerts.push(alertDb.upsertAlert(serverId, 'cpu', resourceSnapshot.cpu.usagePercent, settings.alertCpuThreshold));
  }

  // Memory
  if (resourceSnapshot.memory.usagePercent >= settings.alertMemoryThreshold) {
    alerts.push(alertDb.upsertAlert(serverId, 'memory', resourceSnapshot.memory.usagePercent, settings.alertMemoryThreshold));
  }

  // Disk
  for (const disk of resourceSnapshot.disks) {
    if (settings.alertDiskMountPoints.includes(disk.mountPoint)) {
      if (disk.usagePercent >= settings.alertDiskThreshold) {
        alerts.push(alertDb.upsertAlert(serverId, 'disk', disk.usagePercent, settings.alertDiskThreshold));
      }
    }
  }

  // GPU Temp
  for (const gpu of resourceSnapshot.gpuCards) {
    if (gpu.temperature >= settings.alertGpuTempThreshold) {
      alerts.push(alertDb.upsertAlert(serverId, 'gpu_temp', gpu.temperature, settings.alertGpuTempThreshold));
    }
  }

  // Only return non-suppressed alerts
  const now = Date.now();
  return alerts.filter(a => !a.suppressedUntil || a.suppressedUntil < now);
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
