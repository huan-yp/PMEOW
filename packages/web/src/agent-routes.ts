import {
  AgentDataSource,
  getAgentTask,
  getAgentTasksByServerId,
  getLatestMetrics,
  getServerById,
  isServerSetPriorityPayload,
} from '@monitor/core';
import type { AgentSessionRegistry, Scheduler } from '@monitor/core';
import type { Express, Request, Response } from 'express';

interface AgentRouteOptions {
  scheduler: Scheduler;
  agentRegistry: AgentSessionRegistry;
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

function resolveCommandDataSource(
  serverId: string,
  options: AgentRouteOptions,
  res: Response,
): AgentDataSource | undefined {
  options.scheduler.refreshServerDataSource(serverId);

  const dataSource = options.scheduler.getDataSource(serverId);
  if (!(dataSource instanceof AgentDataSource)) {
    res.status(409).json({ error: 'Agent 未在线' });
    return undefined;
  }

  if (!options.agentRegistry.hasSessionByServerId(serverId) || !dataSource.hasLiveSession()) {
    res.status(409).json({ error: 'Agent 未在线' });
    return undefined;
  }

  return dataSource;
}

function dispatchCommand(res: Response, action: () => void): void {
  try {
    action();
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes('is offline')) {
      res.status(409).json({ error: 'Agent 未在线' });
      return;
    }

    res.status(500).json({ error: error instanceof Error ? error.message : '命令派发失败' });
  }
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

  app.get('/api/servers/:id/gpu-allocation', (req: Request, res: Response) => {
    const serverId = requireServer(req, res);
    if (!serverId) {
      return;
    }

    res.json(getLatestMetrics(serverId)?.gpuAllocation ?? null);
  });

  app.post('/api/servers/:id/tasks/:taskId/cancel', (req: Request, res: Response) => {
    const serverId = requireServer(req, res);
    if (!serverId) {
      return;
    }

    const taskId = requireTaskForServer(serverId, req, res);
    if (!taskId) {
      return;
    }

    const dataSource = resolveCommandDataSource(serverId, options, res);
    if (!dataSource) {
      return;
    }

    dispatchCommand(res, () => {
      dataSource.cancelTask(taskId);
    });
  });

  app.post('/api/servers/:id/queue/pause', (req: Request, res: Response) => {
    const serverId = requireServer(req, res);
    if (!serverId) {
      return;
    }

    const dataSource = resolveCommandDataSource(serverId, options, res);
    if (!dataSource) {
      return;
    }

    dispatchCommand(res, () => {
      dataSource.pauseQueue();
    });
  });

  app.post('/api/servers/:id/queue/resume', (req: Request, res: Response) => {
    const serverId = requireServer(req, res);
    if (!serverId) {
      return;
    }

    const dataSource = resolveCommandDataSource(serverId, options, res);
    if (!dataSource) {
      return;
    }

    dispatchCommand(res, () => {
      dataSource.resumeQueue();
    });
  });

  app.post('/api/servers/:id/tasks/:taskId/priority', (req: Request, res: Response) => {
    const serverId = requireServer(req, res);
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

    const dataSource = resolveCommandDataSource(serverId, options, res);
    if (!dataSource) {
      return;
    }

    dispatchCommand(res, () => {
      dataSource.setPriority(taskId, priority);
    });
  });
}