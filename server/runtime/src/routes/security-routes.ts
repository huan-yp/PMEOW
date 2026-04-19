import { Router } from "express";
import { listSecurityEvents, markSecurityEventSafe, unresolveSecurityEvent } from "@pmeow/core";
import { adminOnly } from "../auth.js";

export function securityRoutes(): Router {
  const router = Router();
  router.use(adminOnly);
  
  router.get("/security/events", (req, res) => {
    const query = {
      serverId: req.query.serverId as string | undefined,
      resolved: req.query.resolved !== undefined ? req.query.resolved === "true" : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    };
    res.json(listSecurityEvents(query));
  });
  
  router.post("/security/events/:id/mark-safe", (req, res) => {
    const { resolvedBy, reason } = req.body;
    const result = markSecurityEventSafe(Number(req.params.id), resolvedBy || "admin", reason || "");
    if (!result) { res.status(404).json({ error: "not found" }); return; }
    res.json(result);
  });
  
  router.post("/security/events/:id/unresolve", (req, res) => {
    const { actor, reason } = req.body;
    const result = unresolveSecurityEvent(Number(req.params.id), actor || "admin", reason || "");
    if ("error" in result) { res.status(400).json(result); return; }
    res.json(result);
  });
  
  return router;
}
