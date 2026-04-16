import {
  getAgentTask,
  getAgentTasksByServerId,
  getLatestMetrics,
  getResolvedGpuAllocation,
  getServerById,
  isServerSetPriorityPayload,
  AgentCommandError,
  isAgentCommandError,
} from '@monitor/core';
import type { AgentCommandService } from '@monitor/core';
import type { Express, Request, Response } from 'express';

interface AgentRouteOptions {
  commandService: AgentCommandService;
}

function getRouteParam(req: Request, name: string): string | undefined {
  const value = req.params[name];
  return typeof value === 'string' ? value : undefined;
}

function requireServer(req: Request, res: Response): string | undefined {
  const serverId = getRouteParam(req, 'id');
  if (serverId && getServerById(serverId)) {
    return serverId;
  }

  res.status(404).json({ error: '服务器不存在' });
  return undefined;
}

function requireTaskForServer(
  serverId: string,
  req: Request,
  res: Response,
): string | undefined {
  const taskId = getRouteParam(req, 'taskId');
  if (!taskId) {
    res.status(404).json({ error: '任务不存在' });
    return undefined;
  }

  const task = getAgentTask(taskId);
  if (!task || task.serverId !== serverId) {
    res.status(404).json({ error: '任务不存在' });
    return undefined;
  }

  return taskId;
}

function resolveServerId(req: Request, res: Response): string | undefined {
  const serverId = requireServer(req, res);
  if (!serverId) return undefined;

  const server = getServerById(serverId);
  if (server && server.sourceType !== 'agent') {
    res.status(409).json({ error: '目标节点不支持该命令' });
    return undefined;
  }

  return serverId;
}

function mapCommandError(error: unknown, res: Response, fallbackMessage: string): void {
  if (isAgentCommandError(error)) {
    const statusMap: Record<string, number> = {
      offline: 409,
      timeout: 504,
      not_supported: 501,
      not_found: 404,
      invalid_target: 409,
      invalid_input: 400,
      internal: 500,
    };
    const status = statusMap[error.code] ?? 500;
    res.status(status).json({ error: error.message });
    return;
  }

  res.status(500).json({ error: error instanceof Error ? error.message : fallbackMessage });
}

function requirePriority(req: Request, taskId: string, res: Response): number | undefined {
  const payload = {
    taskId,
    priority: (req.body as { priority?: unknown } | null | undefined)?.priority,
  };

  if (!isServerSetPriorityPayload(payload)) {
    res.status(400).json({ error: 'priority 必须为整数' });
    return undefined;
  }

  return payload.priority;
}

export function setupAgentReadRoutes(app: Express, options: AgentRouteOptions): void {
  app.get('/api/servers/:id/tasks', (req: Request, res: Response) => {
    const serverId = requireServer(req, res);
    if (!serverId) {
      return;
    }

    res.json(getAgentTasksByServerId(serverId));
  });

  app.get('/api/servers/:id/tasks/:taskId', (req: Request, res: Response) => {
    const serverId = requireServer(req, res);
    const taskId = getRouteParam(req, 'taskId');
    if (!serverId || !taskId) {
      return;
    }

    const task = getAgentTask(taskId);
    if (!task || task.serverId !== serverId) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }

    res.json(task);
  });

  app.get('/api/servers/:id/tasks/:taskId/events', async (req: Request, res: Response) => {
    const serverId = resolveServerId(req, res);
    if (!serverId) {
      return;
    }

    const taskId = requireTaskForServer(serverId, req, res);
    if (!taskId) {
      return;
    }

    const rawAfterId = req.query.afterId;
    const afterId = typeof rawAfterId === 'string' && rawAfterId.trim()
      ? Number(rawAfterId)
      : 0;

    if (!Number.isInteger(afterId) || afterId < 0) {
      res.status(400).json({ error: 'afterId 必须为非负整数' });
      return;
    }

    try {
      res.json(await options.commandService.getTaskEvents(serverId, taskId, afterId));
    } catch (error) {
      mapCommandError(error, res, '获取任务事件失败');
    }
  });

  app.get('/api/servers/:id/tasks/:taskId/audit', async (req: Request, res: Response) => {
    const serverId = resolveServerId(req, res);
    if (!serverId) {
      return;
    }

    const taskId = requireTaskForServer(serverId, req, res);
    if (!taskId) {
      return;
    }

    try {
      const detail = await options.commandService.getTaskAuditDetail(serverId, taskId);
      res.json(detail);
    } catch (error) {
      mapCommandError(error, res, '获取审计详情失败');
    }
  });

  app.get('/api/servers/:id/gpu-allocation', (req: Request, res: Response) => {
    const serverId = requireServer(req, res);
    if (!serverId) {
      return;
    }

    res.json(getLatestMetrics(serverId)?.gpuAllocation ?? null);
  });

  app.get('/api/servers/:id/gpu-allocation/resolved', (req: Request, res: Response) => {
    const serverId = requireServer(req, res);
    if (!serverId) {
      return;
    }

    res.json(getResolvedGpuAllocation(serverId));
  });

  app.post('/api/servers/:id/tasks/:taskId/cancel', (req: Request, res: Response) => {
    const serverId = resolveServerId(req, res);
    if (!serverId) {
      return;
    }

    const taskId = requireTaskForServer(serverId, req, res);
    if (!taskId) {
      return;
    }

    try {
      options.commandService.cancelTask(serverId, taskId);
      res.json({ ok: true });
    } catch (error) {
      mapCommandError(error, res, '命令派发失败');
    }
  });

  app.post('/api/servers/:id/queue/pause', (req: Request, res: Response) => {
    const serverId = resolveServerId(req, res);
    if (!serverId) {
      return;
    }

    try {
      options.commandService.pauseQueue(serverId);
      res.json({ ok: true });
    } catch (error) {
      mapCommandError(error, res, '命令派发失败');
    }
  });

  app.post('/api/servers/:id/queue/resume', (req: Request, res: Response) => {
    const serverId = resolveServerId(req, res);
    if (!serverId) {
      return;
    }

    try {
      options.commandService.resumeQueue(serverId);
      res.json({ ok: true });
    } catch (error) {
      mapCommandError(error, res, '命令派发失败');
    }
  });

  app.post('/api/servers/:id/tasks/:taskId/priority', (req: Request, res: Response) => {
    const serverId = resolveServerId(req, res);
    if (!serverId) {
      return;
    }

    const taskId = requireTaskForServer(serverId, req, res);
    if (!taskId) {
      return;
    }

    const priority = requirePriority(req, taskId, res);
    if (priority === undefined) {
      return;
    }

    try {
      options.commandService.setPriority(serverId, taskId, priority);
      res.json({ ok: true });
    } catch (error) {
      mapCommandError(error, res, '命令派发失败');
    }
  });
}