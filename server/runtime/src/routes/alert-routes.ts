import { Router } from "express";
import { getAlerts, silenceAlert, unsilenceAlert, batchSilenceAlerts, batchUnsilenceAlerts } from "@pmeow/core";
import type { AlertStatus } from "@pmeow/core";
import { adminOnly } from "../auth.js";

export function alertRoutes(): Router {
  const router = Router();

  router.get("/alerts", adminOnly, (req, res) => {
    const serverId = req.query.serverId as string | undefined;
    const status = req.query.status as AlertStatus | undefined;
    let alerts = getAlerts({ serverId, status });

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

  router.post("/alerts/:id/silence", adminOnly, (req, res) => {
    const change = silenceAlert(Number(req.params.id));
    if (!change) { res.status(404).json({ error: "not found or already silenced" }); return; }
    res.json({ ok: true, change });
  });

  router.post("/alerts/:id/unsilence", adminOnly, (req, res) => {
    const change = unsilenceAlert(Number(req.params.id));
    if (!change) { res.status(404).json({ error: "not found or not silenced" }); return; }
    res.json({ ok: true, change });
  });

  router.post("/alerts/batch/silence", adminOnly, (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids)) { res.status(400).json({ error: "ids required" }); return; }
    const changes = batchSilenceAlerts(ids.map(Number));
    res.json({ ok: true, changes });
  });

  router.post("/alerts/batch/unsilence", adminOnly, (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids)) { res.status(400).json({ error: "ids required" }); return; }
    const changes = batchUnsilenceAlerts(ids.map(Number));
    res.json({ ok: true, changes });
  });

  return router;
}
