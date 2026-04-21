import type { UnifiedReport, AppSettings, AlertAnomaly, AlertType, GpuCardReport } from '../types.js';
import type { AgentSessionRegistry } from '../node/registry.js';
import type { AlertStateStore } from './state-store.js';

// ---------------------------------------------------------------------------
// Threshold detectors
// ---------------------------------------------------------------------------

const CPU_ALERT_RECOVERY_DELTA_PERCENT = 5;

interface ThresholdAlertState {
  isActive: boolean;
  lastValue: number;
}

function cpuAlertStateKey(serverId: string): string {
  return `threshold:cpu:${serverId}`;
}

function detectCpuThreshold(
  serverId: string,
  usagePercent: number,
  settings: AppSettings,
  store: AlertStateStore,
): AlertAnomaly | null {
  const key = cpuAlertStateKey(serverId);
  const state = store.get<ThresholdAlertState>(key) ?? { isActive: false, lastValue: usagePercent };
  const activationThreshold = settings.alertCpuThreshold;
  const recoveryThreshold = Math.max(0, activationThreshold - CPU_ALERT_RECOVERY_DELTA_PERCENT);

  if (state.isActive) {
    state.isActive = usagePercent > recoveryThreshold;
  } else if (usagePercent >= activationThreshold) {
    state.isActive = true;
  }

  state.lastValue = usagePercent;
  store.set(key, state);

  if (!state.isActive) {
    return null;
  }

  return {
    alertType: 'cpu',
    value: usagePercent,
    threshold: activationThreshold,
    fingerprint: '',
    details: null,
  };
}

export function detectThresholds(
  serverId: string,
  report: UnifiedReport,
  settings: AppSettings,
  store: AlertStateStore,
): AlertAnomaly[] {
  const anomalies: AlertAnomaly[] = [];
  const { resourceSnapshot } = report;

  const cpuAnomaly = detectCpuThreshold(serverId, resourceSnapshot.cpu.usagePercent, settings, store);
  if (cpuAnomaly) {
    anomalies.push(cpuAnomaly);
  }

  if (resourceSnapshot.memory.usagePercent >= settings.alertMemoryThreshold) {
    anomalies.push({
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
      anomalies.push({
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
      anomalies.push({
        alertType: 'gpu_temp',
        value: gpu.temperature,
        threshold: settings.alertGpuTempThreshold,
        fingerprint: `gpu${gpu.index}`,
        details: { gpuIndex: gpu.index, gpuName: gpu.name },
      });
    }
  }

  return anomalies;
}

// ---------------------------------------------------------------------------
// GPU idle memory detector (stateful — uses StateStore for duration tracking)
// ---------------------------------------------------------------------------

interface TrackedProcess {
  firstSeenAt: number;
  lastSeenAt: number;
  gpuIndex: number;
  pid: number;
  user: string;
  command: string;
  taskId: string | null;
  vramMb: number;
  gpuUtilization: number;
  memoryPercent: number;
}

function storeKey(serverId: string, gpuIndex: number, pid: number): string {
  return `gpu_idle:${serverId}:${gpuIndex}:${pid}`;
}

function makeFingerprint(gpuIndex: number, pid: number): string {
  return `gpu${gpuIndex}:pid${pid}`;
}

function collectGpuProcesses(gpu: GpuCardReport): Array<{
  pid: number; user: string; command: string; taskId: string | null; vramMb: number;
}> {
  const procs: Array<{
    pid: number; user: string; command: string; taskId: string | null; vramMb: number;
  }> = [];

  for (const alloc of gpu.taskAllocations) {
    if (alloc.pid != null && alloc.user) {
      procs.push({
        pid: alloc.pid,
        user: alloc.user,
        command: alloc.command ?? '',
        taskId: alloc.taskId,
        vramMb: alloc.actualVramMb ?? alloc.declaredVramMb,
      });
    }
  }

  for (const proc of gpu.userProcesses) {
    procs.push({
      pid: proc.pid,
      user: proc.user,
      command: '',
      taskId: null,
      vramMb: proc.vramMb,
    });
  }

  return procs;
}

export function detectGpuIdle(
  serverId: string,
  report: UnifiedReport,
  settings: AppSettings,
  store: AlertStateStore,
): AlertAnomaly[] {
  const now = Date.now();
  const anomalies: AlertAnomaly[] = [];
  const seenKeys = new Set<string>();

  for (const gpu of report.resourceSnapshot.gpuCards) {
    const memoryPercent = gpu.memoryTotalMb > 0
      ? (gpu.memoryUsedMb / gpu.memoryTotalMb) * 100
      : 0;

    if (memoryPercent < settings.alertGpuIdleMemoryPercent ||
        gpu.utilizationGpu > settings.alertGpuIdleUtilizationPercent) {
      // Card not in idle-with-memory state — prune all tracked processes for this GPU
      const prefix = `gpu_idle:${serverId}:${gpu.index}:`;
      store.pruneByPrefix(prefix);
      continue;
    }

    const procs = collectGpuProcesses(gpu);
    if (procs.length === 0) {
      const prefix = `gpu_idle:${serverId}:${gpu.index}:`;
      store.pruneByPrefix(prefix);
      continue;
    }

    for (const proc of procs) {
      const key = storeKey(serverId, gpu.index, proc.pid);
      seenKeys.add(key);

      const existing = store.get<TrackedProcess>(key);
      if (existing) {
        existing.lastSeenAt = now;
        existing.vramMb = proc.vramMb;
        existing.gpuUtilization = gpu.utilizationGpu;
        existing.memoryPercent = memoryPercent;
        existing.command = proc.command || existing.command;

        const durationMs = now - existing.firstSeenAt;
        if (durationMs >= settings.alertGpuIdleDurationSeconds * 1000) {
          const durationSeconds = Math.round(durationMs / 1000);
          anomalies.push({
            alertType: 'gpu_idle_memory',
            value: memoryPercent,
            threshold: settings.alertGpuIdleMemoryPercent,
            fingerprint: makeFingerprint(gpu.index, proc.pid),
            details: {
              gpuIndex: gpu.index,
              pid: proc.pid,
              user: existing.user,
              command: existing.command,
              taskId: existing.taskId,
              vramMb: existing.vramMb,
              gpuUtilizationPercent: existing.gpuUtilization,
              gpuMemoryPercent: Math.round(memoryPercent * 10) / 10,
              durationSeconds,
            },
          });
        }
        store.set(key, existing);
      } else {
        store.set<TrackedProcess>(key, {
          firstSeenAt: now,
          lastSeenAt: now,
          gpuIndex: gpu.index,
          pid: proc.pid,
          user: proc.user,
          command: proc.command,
          taskId: proc.taskId,
          vramMb: proc.vramMb,
          gpuUtilization: gpu.utilizationGpu,
          memoryPercent,
        });
      }
    }
  }

  // Prune processes that disappeared for this server
  const serverPrefix = `gpu_idle:${serverId}:`;
  for (const key of Array.from({ length: 0 })) { void key; } // no-op, see below
  // We need to iterate store keys with prefix — use pruneByPrefix selectively
  // Instead, just delete keys that are ours but not seen
  // Store doesn't expose iteration, so track our keys via a secondary index
  const allKeysKey = `gpu_idle_keys:${serverId}`;
  const prevKeys = store.get<Set<string>>(allKeysKey) ?? new Set<string>();
  for (const oldKey of prevKeys) {
    if (!seenKeys.has(oldKey)) {
      store.delete(oldKey);
    }
  }
  store.set(allKeysKey, seenKeys);

  return anomalies;
}

// ---------------------------------------------------------------------------
// Offline detector (stateless — reads from registry)
// ---------------------------------------------------------------------------

export function detectOffline(
  registry: AgentSessionRegistry,
  settings: AppSettings,
  now = Date.now(),
): { serverId: string; anomalies: AlertAnomaly[] }[] {
  const results: { serverId: string; anomalies: AlertAnomaly[] }[] = [];
  const sessions = registry.getAllSessions();

  for (const session of sessions) {
    const lastReport = registry.getLastReportAt(session.agentId) || 0;
    const elapsedMs = now - lastReport;
    if (elapsedMs > settings.alertOfflineSeconds * 1000) {
      results.push({
        serverId: session.serverId,
        anomalies: [{
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
