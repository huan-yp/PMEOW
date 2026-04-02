import {
  getAgentTask,
  getAgentTasksByServerId,
  getLatestMetrics,
  getServerById,
} from '@monitor/core';
import type { Express, Request, Response } from 'express';

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

export function setupAgentReadRoutes(app: Express): void {
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
}