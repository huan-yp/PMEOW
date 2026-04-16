import {
  buildProcessAuditRows,
  getAllCachedTaskQueueGroups,
  getTaskQueueCache,
  getGpuUsageByServerIdAndTimestamp,
  getGpuOverview,
  getGpuUsageSummary,
  getGpuUsageTimelineByUser,
  getGpuUsageBucketed,
  getLatestGpuUsageByServerId,
  getLatestMetrics,
  getMetricsHistory,
  getLatestUnownedGpuDurationMinutes,
  getSettings,
  getServerById,
  listSecurityEvents,
  markSecurityEventSafe,
  unresolveSecurityEvent,
  resolveRawUserPerson,
  type Scheduler,
  type SecurityEventRecord,
} from '@monitor/core';
import type { Express, Request, Response } from 'express';
import type { Namespace } from 'socket.io';
import type { MetricsSnapshot, ProcessAuditRow, ProcessReplayIndexPoint } from '@monitor/core';

interface OperatorRouteOptions {
  scheduler: Scheduler;
  uiNamespace: Namespace;
}

interface AuthenticatedRequest extends Request {
  user?: Record<string, unknown>;
}

const EPOCH_MS_THRESHOLD = 1_000_000_000_000;

function normalizeEpochMs(timestamp: number): number {
  if (!Number.isFinite(timestamp)) {
    return 0;
  }

  return timestamp >= EPOCH_MS_THRESHOLD
    ? Math.round(timestamp)
    : Math.round(timestamp * 1000);
}

function getReplaySnapshots(serverId: string, from: number, to: number): MetricsSnapshot[] {
  const rawMs = getMetricsHistory(serverId, from, to);
  if (rawMs.length > 0 || from < EPOCH_MS_THRESHOLD) {
    return rawMs;
  }

  return getMetricsHistory(serverId, from / 1000, to / 1000);
}

function findReplaySnapshot(serverId: string, timestamp: number): MetricsSnapshot | undefined {
  const exactMs = getMetricsHistory(serverId, timestamp, timestamp);
  if (exactMs.length > 0) {
    return exactMs[0];
  }

  const aroundMs = getMetricsHistory(serverId, timestamp - 1000, timestamp + 1000);
  if (aroundMs.length > 0) {
    return aroundMs.sort((left, right) => Math.abs(left.timestamp - timestamp) - Math.abs(right.timestamp - timestamp))[0];
  }

  const targetSeconds = timestamp / 1000;
  const aroundSeconds = getMetricsHistory(serverId, targetSeconds - 1, targetSeconds + 1);
  if (aroundSeconds.length > 0) {
    return aroundSeconds.sort(
      (left, right) => Math.abs(normalizeEpochMs(left.timestamp) - timestamp) - Math.abs(normalizeEpochMs(right.timestamp) - timestamp),
    )[0];
  }

  return undefined;
}

function resolveProcessRows(serverId: string, snapshot: MetricsSnapshot, mode: 'live' | 'replay'): ProcessAuditRow[] {
  const gpuRows = mode === 'live'
    ? getLatestGpuUsageByServerId(serverId)
    : getGpuUsageByServerIdAndTimestamp(serverId, snapshot.timestamp);
  const settings = getSettings();
  const taskGroup = mode === 'live'
    ? getTaskQueueCache(serverId)
    : undefined;
  const hasRunningPmeowTasks = mode === 'live' ? (taskGroup?.running.length ?? 0) > 0 : false;
  const unownedGpuMinutes = mode === 'live' ? getLatestUnownedGpuDurationMinutes(serverId) : 0;
  const highGpuUtilizationActive = mode === 'live'
    ? snapshot.gpu.utilizationPercent > settings.securityHighGpuUtilizationPercent && !hasRunningPmeowTasks
    : false;

  const rows = buildProcessAuditRows(snapshot, gpuRows, {
    securityMiningKeywords: settings.securityMiningKeywords,
    unownedGpuMinutes,
    hasRunningPmeowTasks,
    highGpuUtilizationActive,
  });

  const resolutionTimestamp = mode === 'live' ? Date.now() : normalizeEpochMs(snapshot.timestamp);
  for (const row of rows) {
    const { person } = resolveRawUserPerson(serverId, row.user, resolutionTimestamp);
    if (person) {
      row.resolvedPersonId = person.id;
      row.resolvedPersonName = person.displayName;
    }
  }

  return rows;
}

function buildReplayIndex(serverId: string, snapshots: MetricsSnapshot[]): ProcessReplayIndexPoint[] {
  return snapshots.map((snapshot) => {
    const rows = resolveProcessRows(serverId, snapshot, 'replay');
    return {
      timestamp: normalizeEpochMs(snapshot.timestamp),
      processCount: rows.length,
      gpuProcessCount: rows.filter((row) => row.gpuMemoryMB > 0 || row.gpuUtilPercent !== undefined).length,
      suspiciousProcessCount: rows.filter((row) => row.suspiciousReasons.length > 0).length,
    };
  });
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
    const getServerName = (serverId: string): string => {
      const server = getServerById(serverId);
      return server?.name ?? serverId;
    };
    res.json(getAllCachedTaskQueueGroups(getServerName));
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

  // Bucketed GPU usage history with auto source/granularity selection
  app.get('/api/gpu-usage/by-user/bucketed', (req: Request, res: Response) => {
    const user = typeof req.query.user === 'string' ? req.query.user.trim() : '';
    if (!user) {
      res.status(400).json({ error: '缺少 user 参数' });
      return;
    }

    const now = Date.now();
    const from = req.query.from ? Number(req.query.from) : (now - parseHours(req.query.hours, 168) * 3600 * 1000);
    const to = req.query.to ? Number(req.query.to) : now;
    const bucketMs = req.query.bucket ? Number(req.query.bucket) : undefined;
    const settings = getSettings();
    const result = getGpuUsageBucketed(user, from, to, bucketMs, settings.rawRetentionDays);
    res.json({
      from,
      to,
      bucketMs: result.bucketMs,
      source: result.source,
      buckets: result.buckets,
    });
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

    res.json(resolveProcessRows(serverId, snapshot, 'live'));
  });

  app.get('/api/servers/:id/process-history/index', (req: Request, res: Response) => {
    const serverId = getRouteParam(req, 'id');
    if (!serverId || !getServerById(serverId)) {
      res.status(404).json({ error: '服务器不存在' });
      return;
    }

    const now = Date.now();
    const from = req.query.from ? Number(req.query.from) : now - 24 * 3_600_000;
    const to = req.query.to ? Number(req.query.to) : now;
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
      res.status(400).json({ error: '非法时间范围' });
      return;
    }

    const snapshots = getReplaySnapshots(serverId, from, to);
    res.json(buildReplayIndex(serverId, snapshots));
  });

  app.get('/api/servers/:id/process-history/frame', (req: Request, res: Response) => {
    const serverId = getRouteParam(req, 'id');
    if (!serverId || !getServerById(serverId)) {
      res.status(404).json({ error: '服务器不存在' });
      return;
    }

    const timestamp = Number(req.query.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      res.status(400).json({ error: '缺少有效时间戳' });
      return;
    }

    const snapshot = findReplaySnapshot(serverId, timestamp);
    if (!snapshot) {
      res.status(404).json({ error: '历史帧不存在' });
      return;
    }

    res.json({
      serverId,
      timestamp: normalizeEpochMs(snapshot.timestamp),
      processes: resolveProcessRows(serverId, snapshot, 'replay'),
    });
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

  app.post('/api/security/events/:id/unresolve', (req: AuthenticatedRequest, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: '非法事件 ID' });
      return;
    }

    const reasonValue = (req.body as { reason?: unknown } | null | undefined)?.reason;
    const reason = typeof reasonValue === 'string' && reasonValue.trim()
      ? reasonValue.trim()
      : 'unresolve';

    const result = unresolveSecurityEvent(id, getAuthenticatedActor(req), reason);
    if ('error' in result) {
      if (result.error === 'not_found') {
        res.status(404).json({ error: '安全事件不存在' });
        return;
      }
      if (result.error === 'not_resolved') {
        res.status(400).json({ error: '该事件尚未被忽略' });
        return;
      }
      if (result.error === 'duplicate_open') {
        res.status(409).json({ error: '相同指纹的事件已处于未处理状态' });
        return;
      }
    }

    const { reopenedEvent, auditEvent } = result as { reopenedEvent: SecurityEventRecord; auditEvent: SecurityEventRecord };
    options.uiNamespace.emit('securityEvent', reopenedEvent);
    options.uiNamespace.emit('securityEvent', auditEvent);

    res.json(result);
  });
}