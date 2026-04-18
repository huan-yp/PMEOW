import { UnifiedReport, AppSettings, AlertCandidate, AlertType } from '../types.js';
import { AgentSessionRegistry } from '../node/registry.js';

/**
 * Pure threshold check — returns the set of anomaly candidates for a single
 * report.  Does NOT touch the DB; the caller (IngestPipeline) feeds these
 * candidates into `reconcileAlerts()` which handles state transitions.
 */
export function collectAlertCandidates(report: UnifiedReport, settings: AppSettings): AlertCandidate[] {
  const candidates: AlertCandidate[] = [];
  const { resourceSnapshot } = report;

  if (resourceSnapshot.cpu.usagePercent >= settings.alertCpuThreshold) {
    candidates.push({
      alertType: 'cpu',
      value: resourceSnapshot.cpu.usagePercent,
      threshold: settings.alertCpuThreshold,
      fingerprint: '',
      details: null,
    });
  }

  if (resourceSnapshot.memory.usagePercent >= settings.alertMemoryThreshold) {
    candidates.push({
      alertType: 'memory',
      value: resourceSnapshot.memory.usagePercent,
      threshold: settings.alertMemoryThreshold,
      fingerprint: '',
      details: null,
    });
  }

  for (const disk of resourceSnapshot.disks) {
    if (!settings.alertDiskMountPoints.includes(disk.mountPoint)) continue;
    if (disk.usagePercent >= settings.alertDiskThreshold) {
      candidates.push({
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
      candidates.push({
        alertType: 'gpu_temp',
        value: gpu.temperature,
        threshold: settings.alertGpuTempThreshold,
        fingerprint: `gpu${gpu.index}`,
        details: { gpuIndex: gpu.index, gpuName: gpu.name },
      });
    }
  }

  return candidates;
}

/**
 * Returns offline anomaly candidates for all sessions whose last report
 * exceeds the threshold.  Called by the ingest pipeline's offline timer.
 */
export function collectOfflineCandidates(
  registry: AgentSessionRegistry,
  settings: AppSettings,
  now = Date.now(),
): { serverId: string; candidates: AlertCandidate[] }[] {
  const results: { serverId: string; candidates: AlertCandidate[] }[] = [];
  const sessions = registry.getAllSessions();

  for (const session of sessions) {
    const lastReport = registry.getLastReportAt(session.agentId) || 0;
    const elapsedMs = now - lastReport;
    if (elapsedMs > settings.alertOfflineSeconds * 1000) {
      results.push({
        serverId: session.serverId,
        candidates: [{
          alertType: 'offline' as AlertType,
          value: elapsedMs / 1000,
          threshold: settings.alertOfflineSeconds,
          fingerprint: '',
          details: null,
        }],
      });
    }
  }

  return results;
}
