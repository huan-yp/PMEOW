import {
  getPersonById,
  getPersonTasks,
  listPersonBindings,
  getAllServers,
  getPersonMobilePreferences,
  updatePersonMobilePreferences,
  getPersonMobileNotifications,
  getPersonUnreadNotificationCount,
  markPersonNotificationRead,
  getTaskQueueCache,
  isAgentCommandError,
} from '@monitor/core';
import type { AgentCommandService, Scheduler, AgentSessionRegistry } from '@monitor/core';
import type { Express, Request, Response, NextFunction } from 'express';

export interface SetupMobilePersonRoutesOptions {
  scheduler: Scheduler;
  agentRegistry: AgentSessionRegistry;
  commandService: AgentCommandService;
}

export function setupMobilePersonRoutes(
  app: Express,
  personAuth: (req: Request, res: Response, next: NextFunction) => void,
  options: SetupMobilePersonRoutesOptions,
): void {
  const { scheduler, agentRegistry, commandService } = options;

  app.get('/api/mobile/me/bootstrap', personAuth, (req, res) => {
    const personId = (req as any).personId as string;
    const person = getPersonById(personId);
    if (!person) return res.status(404).json({ error: 'Person not found' });

    const tasks = getPersonTasks(personId, 168);
    const bindings = listPersonBindings(personId);
    const activeBindings = bindings.filter(b => b.enabled && !b.effectiveTo);

    res.json({
      person,
      runningTaskCount: tasks.filter(t => t.status === 'running').length,
      queuedTaskCount: tasks.filter(t => t.status === 'queued').length,
      boundNodeCount: activeBindings.length,
      unreadNotificationCount: getPersonUnreadNotificationCount(personId),
    });
  });

  app.get('/api/mobile/me/tasks', personAuth, (req, res) => {
    const personId = (req as any).personId as string;
    const hours = Number(req.query.hours ?? 168);
    res.json(getPersonTasks(personId, hours));
  });

  app.post('/api/mobile/me/tasks/:taskId/cancel', personAuth, (req, res) => {
    const personId = (req as any).personId as string;
    const taskId = req.params.taskId as string;

    // Re-check ownership server-side
    const tasks = getPersonTasks(personId, 168);
    const owned = tasks.find(t => t.taskId === taskId);
    if (!owned) return res.status(403).json({ error: 'Task not attributed to you' });

    // Find task in cache to check status
    const cached = owned.serverId ? getTaskQueueCache(owned.serverId) : undefined;
    const allCachedTasks = cached ? [...cached.queued, ...cached.running, ...cached.recent] : [];
    const task = allCachedTasks.find(t => t.taskId === taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    if (task.status !== 'queued' && task.status !== 'running') {
      return res.status(400).json({ error: 'Task is not cancellable' });
    }

    // Forward cancel to the agent command service
    try {
      commandService.cancelTask(task.serverId, taskId);
      res.json({ success: true });
    } catch (error) {
      if (isAgentCommandError(error)) {
        const status = error.code === 'offline' ? 409 : error.code === 'invalid_target' ? 400 : 500;
        return res.status(status).json({ error: error.message });
      }
      res.status(500).json({ error: 'Cannot cancel task' });
    }
  });

  app.get('/api/mobile/me/servers', personAuth, (req, res) => {
    const personId = (req as any).personId as string;
    const bindings = listPersonBindings(personId).filter(b => b.enabled && !b.effectiveTo);
    const servers = getAllServers();
    const statuses = scheduler.getAllStatuses();
    const statusMap = new Map(statuses.map(s => [s.serverId, s]));
    const boundServerIds = new Set(bindings.map(b => b.serverId));

    const result = servers
      .filter(s => boundServerIds.has(s.id))
      .map(s => ({
        id: s.id,
        name: s.name,
        host: s.host,
        status: statusMap.get(s.id)?.status ?? 'disconnected',
        lastSeen: statusMap.get(s.id)?.lastSeen ?? 0,
      }));

    res.json(result);
  });

  app.get('/api/mobile/me/notifications', personAuth, (req, res) => {
    const personId = (req as any).personId as string;
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    res.json(getPersonMobileNotifications(personId, limit, offset));
  });

  app.post('/api/mobile/me/notifications/:id/read', personAuth, (req, res) => {
    markPersonNotificationRead(req.params.id as string);
    res.json({ success: true });
  });

  app.get('/api/mobile/me/preferences', personAuth, (req, res) => {
    const personId = (req as any).personId as string;
    res.json(getPersonMobilePreferences(personId));
  });

  app.put('/api/mobile/me/preferences', personAuth, (req, res) => {
    const personId = (req as any).personId as string;
    res.json(updatePersonMobilePreferences(personId, req.body));
  });
}
