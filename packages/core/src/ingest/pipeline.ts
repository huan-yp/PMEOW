import { UnifiedReport, AlertStateChange, SecurityEventRecord, TaskInfo, AppSettings, AlertCandidate } from '../types.js';
import { TaskEvent } from '../task/events.js';
import { diffTasks } from './task-differ.js';
import { SnapshotScheduler } from './snapshot-scheduler.js';
import * as snapshotDb from '../db/snapshots.js';
import * as taskDb from '../db/tasks.js';
import * as settingsDb from '../db/settings.js';
import * as alertDb from '../db/alerts.js';
import { collectAlertCandidates } from '../alert/service.js';
import { GpuIdleMemoryTracker } from '../alert/gpu-idle-tracker.js';
import { processSecurityCheck } from '../security/pipeline.js';

export interface IngestCallbacks {
  onMetricsUpdate?: (serverId: string, report: UnifiedReport) => void;
  onTaskEvent?: (event: TaskEvent) => void;
  onAlertStateChange?: (change: AlertStateChange) => void;
  onSecurityEvent?: (event: SecurityEventRecord) => void;
}

export class IngestPipeline {
  private latestReports = new Map<string, UnifiedReport>();
  private scheduler = new SnapshotScheduler();
  private gpuIdleTracker = new GpuIdleMemoryTracker();
  
  constructor(private callbacks: IngestCallbacks = {}) {}
  
  processReport(serverId: string, report: UnifiedReport): void {
    const prevReport = this.latestReports.get(serverId);
    const settings = settingsDb.getSettings();
    const now = Date.now();
    const nowSeconds = Math.floor(now / 1000);

    // 1. Store in latestReports cache
    this.latestReports.set(serverId, report);

    // 2. Call Metrics Update
    if (this.callbacks.onMetricsUpdate) {
      this.callbacks.onMetricsUpdate(serverId, report);
    }

    // 3. Task diffing
    const prevTasks = prevReport ? [...prevReport.taskQueue.queued, ...prevReport.taskQueue.running] : [];
    const currTasks = [...report.taskQueue.queued, ...report.taskQueue.running];
    const recentlyEnded = report.taskQueue.recentlyEnded ?? [];
    const diffs = diffTasks(serverId, prevTasks, currTasks, recentlyEnded);
    
    for (const diff of diffs) {
      if (diff.eventType === 'ended') {
        const finishedAt = diff.task.finishedAt ?? nowSeconds;
        taskDb.endTask(diff.task.taskId, finishedAt, diff.task.exitCode ?? null, diff.task.status, diff.task.endReason ?? null);
      } else {
        taskDb.upsertTask(serverId, diff.task);
      }

      if (this.callbacks.onTaskEvent) {
        this.callbacks.onTaskEvent({
          serverId,
          eventType: diff.eventType,
          task: diff.task
        });
      }
    }

    // 4. Alert closed-loop: collect all anomaly candidates, then reconcile
    const thresholdCandidates = collectAlertCandidates(report, settings);
    const gpuIdleCandidates = this.gpuIdleTracker.check(serverId, report, settings);
    const allCandidates: AlertCandidate[] = [...thresholdCandidates, ...gpuIdleCandidates];

    const alertChanges = alertDb.reconcileAlerts(serverId, allCandidates);
    for (const change of alertChanges) {
      if (this.callbacks.onAlertStateChange) {
        this.callbacks.onAlertStateChange(change);
      }
    }

    // 5. Security check
    const securityEvents = processSecurityCheck(serverId, report, settings);
    for (const event of securityEvents) {
      if (this.callbacks.onSecurityEvent) {
        this.callbacks.onSecurityEvent(event);
      }
    }

    // 6. Snapshot Scheduler
    if (this.scheduler.shouldWriteRecent(serverId, now, settings.snapshotRecentIntervalSeconds)) {
      snapshotDb.saveSnapshot(serverId, report, 'recent', report.seq);
      snapshotDb.deleteOldRecentSnapshots(serverId, settings.snapshotRecentKeepCount);
      this.scheduler.markRecentWritten(serverId, now);
    }

    if (this.scheduler.shouldWriteArchive(serverId, now, settings.snapshotArchiveIntervalSeconds)) {
      snapshotDb.saveSnapshot(serverId, report, 'archive', report.seq);
      this.scheduler.markArchiveWritten(serverId, now);
    }
  }

  getLatestReport(serverId: string): UnifiedReport | undefined {
    return this.latestReports.get(serverId);
  }

  getLatestReports(): Map<string, UnifiedReport> {
    return this.latestReports;
  }
}
