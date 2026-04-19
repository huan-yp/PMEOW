import { Router } from "express";
import { canAccessServer, getAccessibleServerIds, getSnapshotHistory, type IngestPipeline } from "@pmeow/core";

export function metricsRoutes(pipeline: IngestPipeline): Router {
  const router = Router();
  
  router.get("/metrics/latest", (req, res) => {
    const principal = req.principal;
    if (!principal) {
      res.status(401).json({ error: "未认证" });
      return;
    }

    const accessibleServerIds = getAccessibleServerIds(principal);
    const reports = pipeline.getLatestReports();
    const result: Record<string, unknown> = {};
    for (const [serverId, report] of reports) {
      if (accessibleServerIds !== null && !accessibleServerIds.includes(serverId)) {
        continue;
      }
      result[serverId] = report;
    }
    res.json(result);
  });
  
  router.get("/metrics/:serverId/history", (req, res) => {
    if (!req.principal) {
      res.status(401).json({ error: "未认证" });
      return;
    }

    const { serverId } = req.params;
    if (!canAccessServer(req.principal, serverId)) {
      res.status(403).json({ error: "无权访问该机器" });
      return;
    }

    const from = Number(req.query.from) || 0;
    const to = Number(req.query.to) || Math.floor(Date.now() / 1000);
    const tier = (req.query.tier as string) || undefined;
    const snapshots = getSnapshotHistory(serverId, from, to, tier as "recent" | "archive" | undefined);
    res.json(snapshots);
  });
  
  return router;
}
