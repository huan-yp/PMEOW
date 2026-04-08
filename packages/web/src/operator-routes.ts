import {
  buildProcessAuditRows,
  getAgentTaskQueueGroups,
  getGpuOverview,
  getGpuUsageSummary,
  getGpuUsageTimelineByUser,
  getLatestGpuUsageByServerId,
  getLatestMetrics,
  getLatestUnownedGpuDurationMinutes,
  getSettings,
  getServerById,
  listSecurityEvents,
  markSecurityEventSafe,
  resolveRawUserPerson,
  type Scheduler,
} from '@monitor/core';
import type { Express, Request, Response } from 'express';
import type { Namespace } from 'socket.io';

interface OperatorRouteOptions {
  scheduler: Scheduler;
  uiNamespace: Namespace;
}

interface AuthenticatedRequest extends Request {
  user?: Record<string, unknown>;
}

function parseHours(value: unknown, defaultHours: number): number {
  if (typeof value !== 'string' || value.trim() === '') {
    return defaultHours;
  }

  const hours = Number(value);
  return Number.isFinite(hours) && hours > 0 ? hours : defaultHours;
}

function parseResolved(value: unknown): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return undefined;
}

function getAuthenticatedActor(req: AuthenticatedRequest): string {
  const role = req.user?.role;
  return typeof role === 'string' && role ? role : 'operator';
}

function getRouteParam(req: Request, name: string): string | undefined {
  const value = req.params[name];
  return typeof value === 'string' ? value : undefined;
}

export function setupOperatorRoutes(app: Express, options: OperatorRouteOptions): void {
  app.get('/api/task-queue', (_req: Request, res: Response) => {
    res.json(getAgentTaskQueueGroups());
  });

  app.get('/api/gpu-overview', (_req: Request, res: Response) => {
    res.json(getGpuOverview());
  });

  app.get('/api/gpu-usage/summary', (req: Request, res: Response) => {
    const hours = parseHours(req.query.hours, 168);
    res.json(getGpuUsageSummary(hours));
  });

  app.get('/api/gpu-usage/by-user', (req: Request, res: Response) => {
    const user = typeof req.query.user === 'string' ? req.query.user.trim() : '';
    if (!user) {
      res.status(400).json({ error: '缺少 user 参数' });
      return;
    }

    const hours = parseHours(req.query.hours, 168);
    res.json(getGpuUsageTimelineByUser(user, hours));
  });

  app.get('/api/servers/:id/process-audit', (req: Request, res: Response) => {
    const serverId = getRouteParam(req, 'id');
    if (!serverId) {
      res.status(404).json({ error: '服务器不存在' });
      return;
    }

    const server = getServerById(serverId);
    if (!server) {
      res.status(404).json({ error: '服务器不存在' });
      return;
    }

    options.scheduler.refreshServerDataSource(serverId);

    const snapshot = getLatestMetrics(serverId);
    if (!snapshot) {
      res.json([]);
      return;
    }

    const gpuRows = getLatestGpuUsageByServerId(serverId);
    const settings = getSettings();
    const taskGroups = getAgentTaskQueueGroups();
    const taskGroup = taskGroups.find((group) => group.serverId === serverId);
    const hasRunningPmeowTasks = (taskGroup?.running.length ?? 0) > 0;
    const unownedGpuMinutes = getLatestUnownedGpuDurationMinutes(serverId);

    const highGpuUtilizationActive =
      snapshot.gpu.utilizationPercent > settings.securityHighGpuUtilizationPercent
      && !hasRunningPmeowTasks;

    const rows = buildProcessAuditRows(snapshot, gpuRows, {
      securityMiningKeywords: settings.securityMiningKeywords,
      unownedGpuMinutes,
      hasRunningPmeowTasks,
      highGpuUtilizationActive,
    });

    const now = Date.now();
    for (const row of rows) {
      const { person } = resolveRawUserPerson(serverId, row.user, now);
      if (person) {
        row.resolvedPersonId = person.id;
        row.resolvedPersonName = person.displayName;
      }
    }

    res.json(rows);
  });

  app.get('/api/security/events', (req: Request, res: Response) => {
    const hours = parseHours(req.query.hours, 168);
    const resolved = parseResolved(req.query.resolved);
    const serverId = typeof req.query.serverId === 'string' && req.query.serverId.trim()
      ? req.query.serverId.trim()
      : undefined;
    const since = Date.now() - hours * 60 * 60 * 1000;

    const events = listSecurityEvents({
      resolved,
      serverId,
    }).filter((event) => event.createdAt >= since);

    res.json(events);
  });

  app.post('/api/security/events/:id/mark-safe', (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: '非法事件 ID' });
      return;
    }

    const reasonValue = (req.body as { reason?: unknown } | null | undefined)?.reason;
    const reason = typeof reasonValue === 'string' && reasonValue.trim()
      ? reasonValue.trim()
      : 'marked safe';

    const result = markSecurityEventSafe(id, getAuthenticatedActor(req), reason);
    if (!result) {
      res.status(404).json({ error: '安全事件不存在' });
      return;
    }

    options.uiNamespace.emit('securityEvent', result.resolvedEvent);
    if (result.auditEvent) {
      options.uiNamespace.emit('securityEvent', result.auditEvent);
    }

    res.json(result);
  });
}