import { Router } from "express";
import { getAlerts, suppressAlert, unsuppressAlert, batchSuppressAlerts, batchUnsuppressAlerts } from "@monitor/core";

export function alertRoutes(): Router {
  const router = Router();
  
  router.get("/alerts", (req, res) => {
    const serverId = req.query.serverId as string | undefined;
    let alerts = getAlerts(serverId);

    // Filter by suppressed status
    const suppressed = req.query.suppressed as string | undefined;
    if (suppressed === 'true') {
      const now = Date.now();
      alerts = alerts.filter(a => a.suppressedUntil != null && a.suppressedUntil > now);
    } else if (suppressed === 'false') {
      const now = Date.now();
      alerts = alerts.filter(a => a.suppressedUntil == null || a.suppressedUntil <= now);
    }

    // Pagination
    const offset = Number(req.query.offset) || 0;
    const limit = Number(req.query.limit) || 0;
    if (limit > 0) {
      alerts = alerts.slice(offset, offset + limit);
    } else if (offset > 0) {
      alerts = alerts.slice(offset);
    }

    res.json(alerts);
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

  router.post("/alerts/batch/suppress", (req, res) => {
    const { ids, until } = req.body;
    if (!Array.isArray(ids) || !until) { res.status(400).json({ error: "ids and until required" }); return; }
    batchSuppressAlerts(ids.map(Number), until);
    res.json({ ok: true });
  });

  router.post("/alerts/batch/unsuppress", (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids)) { res.status(400).json({ error: "ids required" }); return; }
    batchUnsuppressAlerts(ids.map(Number));
    res.json({ ok: true });
  });
  
  return router;
}
