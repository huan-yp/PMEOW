import { Router } from "express";
import { getAllServers, getServerById, createServer, deleteServer, type AgentSessionRegistry } from "@monitor/core";

export function serverRoutes(registry: AgentSessionRegistry): Router {
  const router = Router();
  
  router.get("/servers", (_req, res) => {
    res.json(getAllServers());
  });
  
  router.post("/servers", (req, res) => {
    const { name, agentId } = req.body;
    if (!name || !agentId) { res.status(400).json({ error: "name and agentId required" }); return; }
    const server = createServer({ name, agentId });
    res.status(201).json(server);
  });
  
  router.delete("/servers/:id", (req, res) => {
    const ok = deleteServer(req.params.id);
    if (!ok) { res.status(404).json({ error: "not found" }); return; }
    res.json({ ok: true });
  });
  
  router.get("/statuses", (_req, res) => {
    const servers = getAllServers();
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
