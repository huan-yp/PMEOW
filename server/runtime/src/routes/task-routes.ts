import { Router } from "express";
import { canAccessTask, cancelTask, countTasksForPrincipal, getTask, getTaskScheduleHistory, listTasksForPrincipal, setPriority, type AgentSessionRegistry, type TaskRecord } from "@pmeow/core";
import { adminOnly } from "../auth.js";
import { parsePagination } from "./pagination.js";

function toApiTask(r: TaskRecord, scheduleHistoryOverride?: unknown) {
  return {
    ...r,
    gpuIds: r.gpuIds ? JSON.parse(r.gpuIds) : null,
    assignedGpus: r.assignedGpus ? JSON.parse(r.assignedGpus) : null,
    scheduleHistory: scheduleHistoryOverride ?? (r.scheduleHistory ? JSON.parse(r.scheduleHistory) : null),
  };
}

export function taskRoutes(registry: AgentSessionRegistry): Router {
  const router = Router();
  
  router.get("/tasks", (req, res) => {
    const principal = req.principal;
    if (!principal) {
      res.status(401).json({ error: "未认证" });
      return;
    }

    const { limit, offset } = parsePagination(req.query);
    const filter = {
      serverId: req.query.serverId as string | undefined,
      status: req.query.status as string | undefined,
      user: req.query.user as string | undefined,
    };

    const total = countTasksForPrincipal(principal, filter);
    const tasks = listTasksForPrincipal(principal, { ...filter, limit, offset }).map(toApiTask);
    res.json({ tasks, total });
  });
  
  router.get("/tasks/:taskId", (req, res) => {
    const principal = req.principal;
    if (!principal) {
      res.status(401).json({ error: "未认证" });
      return;
    }

    const task = getTask(req.params.taskId);
    if (!task) { res.status(404).json({ error: "not found" }); return; }
    if (principal.kind !== "admin" && !canAccessTask(principal, task.serverId, task.user)) {
      res.status(403).json({ error: "无权访问该任务" });
      return;
    }
    res.json(toApiTask(task, getTaskScheduleHistory(task)));
  });
  
  router.post("/servers/:serverId/tasks/:taskId/cancel", (req, res) => {
    const principal = req.principal;
    if (!principal) {
      res.status(401).json({ error: "未认证" });
      return;
    }

    const task = getTask(req.params.taskId);
    if (!task || task.serverId !== req.params.serverId) {
      res.status(404).json({ error: "not found" });
      return;
    }
    if (principal.kind !== "admin" && !canAccessTask(principal, task.serverId, task.user)) {
      res.status(403).json({ error: "无权取消该任务" });
      return;
    }

    try {
      cancelTask(registry, req.params.serverId, req.params.taskId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });
  
  router.post("/servers/:serverId/tasks/:taskId/priority", adminOnly, (req, res) => {
    const { priority } = req.body;
    if (typeof priority !== "number") { res.status(400).json({ error: "priority required" }); return; }
    try {
      setPriority(registry, req.params.serverId as string, req.params.taskId as string, priority);
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
