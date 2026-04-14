import {
  getAllServers,
  getAgentTasksByServerId,
  getAlerts,
  type Scheduler,
} from '@monitor/core';
import type { Express } from 'express';

export interface SetupMobileAdminRoutesOptions {
  scheduler: Scheduler;
}

export function setupMobileAdminRoutes(app: Express, options: SetupMobileAdminRoutesOptions): void {
  const { scheduler } = options;

  app.get('/api/mobile/admin/summary', (_req, res) => {
    const servers = getAllServers();
    const statuses = scheduler.getAllStatuses();
    const onlineCount = statuses.filter(s => s.status === 'connected').length;

    let totalRunning = 0;
    let totalQueued = 0;
    for (const server of servers) {
      const tasks = getAgentTasksByServerId(server.id);
      for (const t of tasks) {
        if (t.status === 'running') totalRunning++;
        else if (t.status === 'queued') totalQueued++;
      }
    }

    res.json({
      serverCount: servers.length,
      onlineServerCount: onlineCount,
      totalRunningTasks: totalRunning,
      totalQueuedTasks: totalQueued,
    });
  });

  app.get('/api/mobile/admin/tasks', (_req, res) => {
    const servers = getAllServers();
    const result: any[] = [];
    for (const server of servers) {
      const tasks = getAgentTasksByServerId(server.id);
      for (const t of tasks) {
        result.push({ ...t, serverName: server.name });
      }
    }
    result.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    res.json(result);
  });

  app.get('/api/mobile/admin/servers', (_req, res) => {
    const servers = getAllServers();
    const statuses = scheduler.getAllStatuses();
    const statusMap = new Map(statuses.map(s => [s.serverId, s]));

    res.json(servers.map(s => ({
      id: s.id,
      name: s.name,
      host: s.host,
      sourceType: s.sourceType,
      status: statusMap.get(s.id)?.status ?? 'disconnected',
      lastSeen: statusMap.get(s.id)?.lastSeen ?? 0,
    })));
  });

  app.get('/api/mobile/admin/notifications', (_req, res) => {
    const alerts = getAlerts({ limit: 50 });
    res.json(alerts);
  });
}
