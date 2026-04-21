import { Router } from "express";
import { createServer, deleteServer, getAccessibleServerIds, getAllServers, updateServer, type AgentSessionRegistry } from "@pmeow/core";
import { adminOnly } from "../auth.js";
import type { UIBroadcast } from "../realtime.js";

export function serverRoutes(registry: AgentSessionRegistry, broadcast?: Pick<UIBroadcast, "serversChanged">): Router {
  const router = Router();
  
  router.get("/servers", (req, res) => {
    const principal = req.principal;
    if (!principal) {
      res.status(401).json({ error: "未认证" });
      return;
    }

    const servers = getAllServers();
    const accessibleServerIds = getAccessibleServerIds(principal);
    res.json(accessibleServerIds === null ? servers : servers.filter((server) => accessibleServerIds.includes(server.id)));
  });
  
  router.post("/servers", adminOnly, (req, res) => {
    const { name, agentId } = req.body;
    if (!name || !agentId) { res.status(400).json({ error: "name and agentId required" }); return; }
    const server = createServer({ name, agentId });
    broadcast?.serversChanged();
    res.status(201).json(server);
  });

  router.put("/servers/:id", adminOnly, (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : undefined;
    const agentId = typeof req.body?.agentId === "string" ? req.body.agentId.trim() : undefined;

    if (name !== undefined && !name) {
      res.status(400).json({ error: "name cannot be empty" });
      return;
    }
    if (agentId !== undefined && !agentId) {
      res.status(400).json({ error: "agentId cannot be empty" });
      return;
    }
    if (name === undefined && agentId === undefined) {
      res.status(400).json({ error: "name or agentId required" });
      return;
    }

    const server = updateServer(req.params.id as string, { name, agentId });
    if (!server) {
      res.status(404).json({ error: "not found" });
      return;
    }

    broadcast?.serversChanged();
    res.json(server);
  });
  
  router.delete("/servers/:id", adminOnly, (req, res) => {
    const ok = deleteServer(req.params.id as string);
    if (!ok) { res.status(404).json({ error: "not found" }); return; }
    broadcast?.serversChanged();
    res.json({ ok: true });
  });
  
  router.get("/statuses", (req, res) => {
    const principal = req.principal;
    if (!principal) {
      res.status(401).json({ error: "未认证" });
      return;
    }

    const accessibleServerIds = getAccessibleServerIds(principal);
    const servers = getAllServers().filter((server) => accessibleServerIds === null || accessibleServerIds.includes(server.id));
    const result: Record<string, { serverId: string; status: string; lastSeenAt: number | null; version: string }> = {};
    for (const s of servers) {
      const session = registry.getSession(s.agentId);
      const lastReportAt = registry.getLastReportAt(s.agentId);
      result[s.id] = {
        serverId: s.id,
        status: session ? 'online' : 'offline',
        lastSeenAt: lastReportAt ?? null,
        version: '',
      };
    }
    res.json(result);
  });
  
  return router;
}
