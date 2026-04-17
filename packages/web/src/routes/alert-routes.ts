import { Router } from "express";
import { getAlerts, suppressAlert, unsuppressAlert } from "@monitor/core";

export function alertRoutes(): Router {
  const router = Router();
  
  router.get("/alerts", (req, res) => {
    const serverId = req.query.serverId as string | undefined;
    res.json(getAlerts(serverId));
  });
  
  router.post("/alerts/:id/suppress", (req, res) => {
    const { until } = req.body;
    if (!until) { res.status(400).json({ error: "until required" }); return; }
    suppressAlert(Number(req.params.id), until);
    res.json({ ok: true });
  });
  
  router.post("/alerts/:id/unsuppress", (req, res) => {
    unsuppressAlert(Number(req.params.id));
    res.json({ ok: true });
  });
  
  return router;
}
