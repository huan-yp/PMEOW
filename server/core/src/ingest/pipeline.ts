import { UnifiedReport, AlertStateChange, SecurityEventRecord } from '../types.js';
import { TaskEvent } from '../task/events.js';
import { TaskEngine } from '../task/engine.js';
import { SnapshotScheduler } from './snapshot-scheduler.js';
import * as snapshotDb from '../db/snapshots.js';
import * as settingsDb from '../db/settings.js';
import { AlertEngine } from '../alert/engine.js';
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
  private taskEngine = new TaskEngine();
  
  constructor(
    private callbacks: IngestCallbacks = {},
    private alertEngine?: AlertEngine,
  ) {}
  
  processReport(serverId: string, report: UnifiedReport): void {
    const prevReport = this.latestReports.get(serverId);
    const settings = settingsDb.getSettings();
    const now = Date.now();

    // 1. Store in latestReports cache
    this.latestReports.set(serverId, report);

    // 2. Metrics update
    if (this.callbacks.onMetricsUpdate) {
      this.callbacks.onMetricsUpdate(serverId, report);
    }

    // 3. Task processing — delegate to task domain
    const taskEvents = this.taskEngine.processReport(serverId, prevReport, report);
    for (const event of taskEvents) {
      if (this.callbacks.onTaskEvent) {
        this.callbacks.onTaskEvent(event);
      }
    }

    // 4. Alert closed-loop: delegate to AlertEngine
    if (this.alertEngine) {
      const { broadcastable } = this.alertEngine.processReport(serverId, report, settings);
      for (const change of broadcastable) {
        if (this.callbacks.onAlertStateChange) {
          this.callbacks.onAlertStateChange(change);
        }
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
