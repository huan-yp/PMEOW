import { Router } from "express";
import { getTasks, getTaskById, cancelTask, setPriority, type AgentSessionRegistry } from "@monitor/core";

export function taskRoutes(registry: AgentSessionRegistry): Router {
  const router = Router();
  
  router.get("/tasks", (req, res) => {
    const filter = {
      serverId: req.query.serverId as string | undefined,
      status: req.query.status as string | undefined,
      user: req.query.user as string | undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    };
    res.json(getTasks(filter));
  });
  
  router.get("/tasks/:taskId", (req, res) => {
    const task = getTaskById(req.params.taskId);
    if (!task) { res.status(404).json({ error: "not found" }); return; }
    res.json(task);
  });
  
  router.post("/servers/:serverId/tasks/:taskId/cancel", (req, res) => {
    try {
      cancelTask(registry, req.params.serverId, req.params.taskId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });
  
  router.post("/servers/:serverId/tasks/:taskId/priority", (req, res) => {
    const { priority } = req.body;
    if (typeof priority !== "number") { res.status(400).json({ error: "priority required" }); return; }
    try {
      setPriority(registry, req.params.serverId, req.params.taskId, priority);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });
  
  router.get("/gpu-overview", (_req, res) => {
    res.json({ servers: [], users: [] });
  });
  
  return router;
}
