import { Router } from "express";
import { createServer, deleteServer, getAccessibleServerIds, getAllServers, type AgentSessionRegistry } from "@pmeow/core";
import { adminOnly } from "../auth.js";

export function serverRoutes(registry: AgentSessionRegistry): Router {
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
    res.status(201).json(server);
  });
  
  router.delete("/servers/:id", adminOnly, (req, res) => {
    const ok = deleteServer(req.params.id as string);
    if (!ok) { res.status(404).json({ error: "not found" }); return; }
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
