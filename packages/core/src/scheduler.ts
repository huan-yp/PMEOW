import { EventEmitter } from 'events';
import { getAllServers, getServerById } from './db/servers.js';
import { saveMetrics, cleanOldMetrics } from './db/metrics.js';
import { ingestAgentMetrics } from './agent/ingest.js';
import { cleanOldGpuUsage } from './db/gpu-usage.js';
import { getSettings } from './db/settings.js';
import { checkAlerts } from './alerts.js';
import { evaluateHooks } from './hooks/engine.js';
import { processSecuritySnapshot } from './security/pipeline.js';
import { createDataSource } from './datasource/factory.js';
import { SSHManager } from './ssh/manager.js';
import { SSHDataSource } from './datasource/ssh-datasource.js';
import { AgentDataSource } from './datasource/agent-datasource.js';
import type { NodeDataSource } from './datasource/types.js';
import type { MetricsSnapshot, ServerStatus, ConnectionStatus } from './types.js';

export class Scheduler extends EventEmitter {
  private sharedSSH = new SSHManager();
  private dataSources = new Map<string, NodeDataSource>();
  private timerId: ReturnType<typeof setInterval> | null = null;
  private cleanupTimerId: ReturnType<typeof setInterval> | null = null;
  private serverStatuses = new Map<string, ServerStatus>();

  getSSHManager(): SSHManager {
    return this.sharedSSH;
  }

  getDataSource(serverId: string): NodeDataSource | undefined {
    return this.dataSources.get(serverId);
  }

  getServerStatus(serverId: string): ServerStatus | undefined {
    return this.serverStatuses.get(serverId);
  }

  getAllStatuses(): ServerStatus[] {
    return Array.from(this.serverStatuses.values());
  }

  /** Initialize or refresh data sources for all configured servers. */
  initDataSources(): void {
    const servers = getAllServers();
    const currentIds = new Set(servers.map(s => s.id));

    // Remove stale datasources
    for (const [id] of this.dataSources) {
      if (!currentIds.has(id)) {
        this.refreshServerDataSource(id);
      }
    }

    // Create or update datasources
    for (const server of servers) {
      this.refreshServerDataSource(server.id);
    }
  }

  refreshServerDataSource(serverId: string): void {
    const server = getServerById(serverId);
    const existing = this.dataSources.get(serverId);

    if (!server) {
      if (existing) {
        existing.disconnect();
        this.dataSources.delete(serverId);
      }
      return;
    }

    if (existing instanceof SSHDataSource && server.sourceType === 'ssh') {
      existing.updateServer(server);
      return;
    }

    if (
      existing instanceof AgentDataSource
      && server.sourceType === 'agent'
      && existing.agentId === server.agentId
    ) {
      return;
    }

    if (existing) {
      existing.disconnect();
    }

    const ds = createDataSource(server, this.sharedSSH);
    this.dataSources.set(server.id, ds);
    this.attachDataSourceListeners(ds, server.id);
  }

  start(): void {
    if (this.timerId) return;

    this.initDataSources();

    const settings = getSettings();
    this.timerId = setInterval(() => {
      this.collectAllSSH();
    }, settings.refreshIntervalMs);

    // Run immediately
    this.collectAllSSH();

    // Cleanup old metrics every hour
    this.cleanupTimerId = setInterval(() => {
      const s = getSettings();
      cleanOldMetrics(s.historyRetentionDays);
      cleanOldGpuUsage(s.historyRetentionDays);
    }, 60 * 60 * 1000);
  }

  stop(): void {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.cleanupTimerId) {
      clearInterval(this.cleanupTimerId);
      this.cleanupTimerId = null;
    }
    for (const ds of this.dataSources.values()) {
      ds.disconnect();
    }
    this.dataSources.clear();
    this.sharedSSH.disconnectAll();
  }

  restart(): void {
    this.stop();
    this.start();
  }

  /** Only poll SSH data sources. Agent sources push data themselves. */
  private async collectAllSSH(): Promise<void> {
    const sshSources = Array.from(this.dataSources.values())
      .filter((ds): ds is SSHDataSource => ds.type === 'ssh');

    const promises = sshSources.map(ds => this.collectFromSource(ds));
    await Promise.allSettled(promises);
  }

  /** Collect from a single data source (used for SSH polling and on-demand). */
  async collectServer(serverId: string): Promise<MetricsSnapshot | null> {
    const ds = this.dataSources.get(serverId);
    if (!ds) {
      // Maybe server was just created or its binding changed.
      this.refreshServerDataSource(serverId);
      const refreshed = this.dataSources.get(serverId);
      if (!refreshed) return null;
      if (refreshed instanceof AgentDataSource) {
        return refreshed.collectMetrics();
      }
      return this.collectFromSource(refreshed);
    }

    if (ds instanceof AgentDataSource) {
      return ds.collectMetrics();
    }

    return this.collectFromSource(ds);
  }

  private attachDataSourceListeners(ds: NodeDataSource, serverId: string): void {
    if (ds instanceof AgentDataSource) {
      ds.on('metricsReceived', (snapshot: MetricsSnapshot) => {
        this.handleMetrics(snapshot, serverId);
      });
    }
  }

  private async collectFromSource(ds: NodeDataSource): Promise<MetricsSnapshot | null> {
    const updateStatus = (status: ConnectionStatus, error?: string) => {
      const s: ServerStatus = {
        serverId: ds.serverId,
        status,
        lastSeen: Date.now(),
        error,
      };
      this.serverStatuses.set(ds.serverId, s);
      this.emit('serverStatus', s);
    };

    try {
      if (!ds.isConnected()) {
        updateStatus('connecting');
        await ds.connect();
      }
      updateStatus('connected');

      const snapshot = await ds.collectMetrics();
      if (!snapshot) return null;

      this.handleMetrics(snapshot, ds.serverId);
      return snapshot;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      updateStatus('error', errMsg);
      ds.disconnect();
      return null;
    }
  }

  /** Shared post-collection pipeline: save, alert, hook, broadcast. */
  private handleMetrics(snapshot: MetricsSnapshot, serverId: string): void {
    if (this.dataSources.get(serverId) instanceof AgentDataSource) {
      ingestAgentMetrics(snapshot);
    } else {
      saveMetrics(snapshot);
    }

    // Update status with latest metrics
    const status = this.serverStatuses.get(serverId);
    if (status) {
      status.latestMetrics = snapshot;
      status.lastSeen = Date.now();
      status.status = 'connected';
    } else {
      this.serverStatuses.set(serverId, {
        serverId,
        status: 'connected',
        lastSeen: Date.now(),
        latestMetrics: snapshot,
      });
    }
    this.emit('serverStatus', this.serverStatuses.get(serverId));

    // Emit to listeners (web UI via Socket.IO)
    this.emit('metricsUpdate', snapshot);

    // Check alerts
    const settings = getSettings();
    const server = getServerById(serverId);
    if (server) {
      checkAlerts(snapshot, settings, server);

      const securityEvents = processSecuritySnapshot(serverId, settings, snapshot.timestamp, snapshot);
      for (const event of securityEvents) {
        this.emit('securityEvent', event);
      }
    }

    // Evaluate hooks
    evaluateHooks(snapshot).catch(() => {});
  }
}
