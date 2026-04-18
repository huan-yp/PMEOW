import type { UnifiedReport, AppSettings, AlertAnomaly, AlertStateChange, AlertEngineResult } from '../types.js';
import type { AgentSessionRegistry } from '../node/registry.js';
import { AlertStateStore } from './state-store.js';
import { detectThresholds, detectGpuIdle, detectOffline } from './detectors.js';
import { reconcileAlerts } from '../db/alerts.js';

function isBroadcastable(change: AlertStateChange): boolean {
  const { fromStatus, toStatus } = change;
  // 新 ACTIVE (resolved→active), 恢复 (active→resolved)
  return (fromStatus === 'resolved' && toStatus === 'active') ||
         (fromStatus === 'active' && toStatus === 'resolved');
}

export class AlertEngine {
  private store = new AlertStateStore();

  /**
   * Main entry point: receives a raw report, updates state table,
   * computes anomalies, and reconciles against the DB.
   */
  processReport(serverId: string, report: UnifiedReport, settings: AppSettings): AlertEngineResult {
    // 1. 状态表 + 异常表
    const anomalies: AlertAnomaly[] = [
      ...detectThresholds(report, settings),
      ...detectGpuIdle(serverId, report, settings, this.store),
    ];

    // 2. 告警闭环
    const allChanges = reconcileAlerts(serverId, anomalies);
    const broadcastable = allChanges.filter(isBroadcastable);

    return { allChanges, broadcastable };
  }

  /**
   * Periodic sweep for offline servers.
   * Called by the app-level timer, not by the ingest pipeline.
   */
  sweepOffline(registry: AgentSessionRegistry, settings: AppSettings): AlertEngineResult {
    const offlineResults = detectOffline(registry, settings);

    const allChanges: AlertStateChange[] = [];
    const broadcastable: AlertStateChange[] = [];

    for (const { serverId, anomalies } of offlineResults) {
      const changes = reconcileAlerts(serverId, anomalies);
      allChanges.push(...changes);
      broadcastable.push(...changes.filter(isBroadcastable));
    }

    return { allChanges, broadcastable };
  }
}
