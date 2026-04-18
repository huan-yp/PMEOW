import type { UnifiedReport, AppSettings, AlertRecord, GpuCardReport } from '../types.js';
import * as alertDb from '../db/alerts.js';

interface TrackedProcess {
  firstSeenAt: number;   // ms timestamp when this process first met idle criteria
  lastSeenAt: number;    // ms timestamp of last update
  alertIssuedAt: number | null;
  gpuIndex: number;
  pid: number;
  user: string;
  command: string;
  taskId: string | null;
  vramMb: number;
  gpuUtilization: number;
  memoryPercent: number;
}

type TrackerKey = string; // `${serverId}:${gpuIndex}:${pid}`

function makeKey(serverId: string, gpuIndex: number, pid: number): TrackerKey {
  return `${serverId}:${gpuIndex}:${pid}`;
}

function makeFingerprint(gpuIndex: number, pid: number): string {
  return `gpu${gpuIndex}:pid${pid}`;
}

export class GpuIdleMemoryTracker {
  private tracked = new Map<TrackerKey, TrackedProcess>();

  check(serverId: string, report: UnifiedReport, settings: AppSettings): AlertRecord[] {
    const now = Date.now();
    const alerts: AlertRecord[] = [];
    const seenKeys = new Set<TrackerKey>();

    for (const gpu of report.resourceSnapshot.gpuCards) {
      const memoryPercent = gpu.memoryTotalMb > 0
        ? (gpu.memoryUsedMb / gpu.memoryTotalMb) * 100
        : 0;

      // Skip card if memory usage below threshold
      if (memoryPercent < settings.alertGpuIdleMemoryPercent) {
        this.pruneGpu(serverId, gpu.index);
        continue;
      }

      // Skip card if GPU utilization is above idle threshold
      if (gpu.utilizationGpu > settings.alertGpuIdleUtilizationPercent) {
        this.pruneGpu(serverId, gpu.index);
        continue;
      }

      // Collect candidate processes from this GPU card
      const candidates = this.collectCandidates(gpu);
      if (candidates.length === 0) {
        this.pruneGpu(serverId, gpu.index);
        continue;
      }

      for (const candidate of candidates) {
        const key = makeKey(serverId, gpu.index, candidate.pid);
        seenKeys.add(key);

        const existing = this.tracked.get(key);
        if (existing) {
          // Update with latest info
          existing.lastSeenAt = now;
          existing.vramMb = candidate.vramMb;
          existing.gpuUtilization = gpu.utilizationGpu;
          existing.memoryPercent = memoryPercent;
          existing.command = candidate.command || existing.command;

          // Check duration
          const durationMs = now - existing.firstSeenAt;
          if (durationMs >= settings.alertGpuIdleDurationSeconds * 1000 && existing.alertIssuedAt === null) {
            const alert = this.emitAlert(serverId, existing, settings, durationMs);
            existing.alertIssuedAt = now;
            alerts.push(alert);
          }
        } else {
          // Start tracking
          this.tracked.set(key, {
            firstSeenAt: now,
            lastSeenAt: now,
            alertIssuedAt: null,
            gpuIndex: gpu.index,
            pid: candidate.pid,
            user: candidate.user,
            command: candidate.command,
            taskId: candidate.taskId,
            vramMb: candidate.vramMb,
            gpuUtilization: gpu.utilizationGpu,
            memoryPercent,
          });
        }
      }
    }

    // Prune processes that disappeared for this server
    for (const [key] of this.tracked) {
      if (key.startsWith(`${serverId}:`) && !seenKeys.has(key)) {
        this.tracked.delete(key);
      }
    }

    // Filter suppressed
    return alerts.filter(a => !a.suppressedUntil || a.suppressedUntil < now);
  }

  private collectCandidates(gpu: GpuCardReport): Array<{
    pid: number; user: string; command: string; taskId: string | null; vramMb: number;
  }> {
    const candidates: Array<{
      pid: number; user: string; command: string; taskId: string | null; vramMb: number;
    }> = [];

    // Managed task processes
    for (const alloc of gpu.taskAllocations) {
      if (alloc.pid != null && alloc.user) {
        candidates.push({
          pid: alloc.pid,
          user: alloc.user,
          command: alloc.command ?? '',
          taskId: alloc.taskId,
          vramMb: alloc.actualVramMb ?? alloc.declaredVramMb,
        });
      }
    }

    // User processes
    for (const proc of gpu.userProcesses) {
      candidates.push({
        pid: proc.pid,
        user: proc.user,
        command: '',
        taskId: null,
        vramMb: proc.vramMb,
      });
    }

    return candidates;
  }

  private emitAlert(
    serverId: string,
    proc: TrackedProcess,
    settings: AppSettings,
    durationMs: number,
  ): AlertRecord {
    const fingerprint = makeFingerprint(proc.gpuIndex, proc.pid);
    const durationSeconds = Math.round(durationMs / 1000);

    const details: Record<string, unknown> = {
      gpuIndex: proc.gpuIndex,
      pid: proc.pid,
      user: proc.user,
      command: proc.command,
      taskId: proc.taskId,
      vramMb: proc.vramMb,
      gpuUtilizationPercent: proc.gpuUtilization,
      gpuMemoryPercent: Math.round(proc.memoryPercent * 10) / 10,
      durationSeconds,
    };

    return alertDb.upsertAlert(
      serverId,
      'gpu_idle_memory',
      proc.memoryPercent,
      settings.alertGpuIdleMemoryPercent,
      fingerprint,
      details,
    );
  }

  private pruneGpu(serverId: string, gpuIndex: number): void {
    const prefix = `${serverId}:${gpuIndex}:`;
    for (const key of this.tracked.keys()) {
      if (key.startsWith(prefix)) {
        this.tracked.delete(key);
      }
    }
  }
}
