import type { UnifiedReport, AppSettings, AlertCandidate, GpuCardReport } from '../types.js';

interface TrackedProcess {
  firstSeenAt: number;
  lastSeenAt: number;
  alertEmitted: boolean;
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

/**
 * Tracks GPU processes that occupy VRAM while GPU utilization is low.
 * Returns AlertCandidate[] (does NOT write to DB).
 */
export class GpuIdleMemoryTracker {
  private tracked = new Map<TrackerKey, TrackedProcess>();

  check(serverId: string, report: UnifiedReport, settings: AppSettings): AlertCandidate[] {
    const now = Date.now();
    const candidates: AlertCandidate[] = [];
    const seenKeys = new Set<TrackerKey>();

    for (const gpu of report.resourceSnapshot.gpuCards) {
      const memoryPercent = gpu.memoryTotalMb > 0
        ? (gpu.memoryUsedMb / gpu.memoryTotalMb) * 100
        : 0;

      if (memoryPercent < settings.alertGpuIdleMemoryPercent) {
        this.pruneGpu(serverId, gpu.index);
        continue;
      }

      if (gpu.utilizationGpu > settings.alertGpuIdleUtilizationPercent) {
        this.pruneGpu(serverId, gpu.index);
        continue;
      }

      const procs = this.collectCandidates(gpu);
      if (procs.length === 0) {
        this.pruneGpu(serverId, gpu.index);
        continue;
      }

      for (const proc of procs) {
        const key = makeKey(serverId, gpu.index, proc.pid);
        seenKeys.add(key);

        const existing = this.tracked.get(key);
        if (existing) {
          existing.lastSeenAt = now;
          existing.vramMb = proc.vramMb;
          existing.gpuUtilization = gpu.utilizationGpu;
          existing.memoryPercent = memoryPercent;
          existing.command = proc.command || existing.command;

          const durationMs = now - existing.firstSeenAt;
          if (durationMs >= settings.alertGpuIdleDurationSeconds * 1000) {
            candidates.push(this.toCandidate(existing, settings, durationMs));
            existing.alertEmitted = true;
          }
        } else {
          this.tracked.set(key, {
            firstSeenAt: now,
            lastSeenAt: now,
            alertEmitted: false,
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
    for (const [key] of this.tracked) {
      if (key.startsWith(`${serverId}:`) && !seenKeys.has(key)) {
        this.tracked.delete(key);
      }
    }

    return candidates;
  }

  private collectCandidates(gpu: GpuCardReport): Array<{
    pid: number; user: string; command: string; taskId: string | null; vramMb: number;
  }> {
    const candidates: Array<{
      pid: number; user: string; command: string; taskId: string | null; vramMb: number;
    }> = [];

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

  private toCandidate(
    proc: TrackedProcess,
    settings: AppSettings,
    durationMs: number,
  ): AlertCandidate {
    const fingerprint = makeFingerprint(proc.gpuIndex, proc.pid);
    const durationSeconds = Math.round(durationMs / 1000);

    return {
      alertType: 'gpu_idle_memory',
      value: proc.memoryPercent,
      threshold: settings.alertGpuIdleMemoryPercent,
      fingerprint,
      details: {
        gpuIndex: proc.gpuIndex,
        pid: proc.pid,
        user: proc.user,
        command: proc.command,
        taskId: proc.taskId,
        vramMb: proc.vramMb,
        gpuUtilizationPercent: proc.gpuUtilization,
        gpuMemoryPercent: Math.round(proc.memoryPercent * 10) / 10,
        durationSeconds,
      },
    };
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
