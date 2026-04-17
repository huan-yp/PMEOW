import { Router } from "express";
import { getLatestSnapshot, getSnapshotHistory, type IngestPipeline } from "@monitor/core";

export function metricsRoutes(pipeline: IngestPipeline): Router {
  const router = Router();
  
  router.get("/metrics/latest", (_req, res) => {
    const reports = pipeline.getLatestReports();
    const result: Record<string, unknown> = {};
    for (const [serverId, report] of reports) {
      result[serverId] = report;
    }
    res.json(result);
  });
  
  router.get("/metrics/:serverId/history", (req, res) => {
    const { serverId } = req.params;
    const from = Number(req.query.from) || 0;
    const to = Number(req.query.to) || Math.floor(Date.now() / 1000);
    const tier = (req.query.tier as string) || undefined;
    const snapshots = getSnapshotHistory(serverId, from, to, tier as "recent" | "archive" | undefined);
    res.json(snapshots);
  });
  
  return router;
}
