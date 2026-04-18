import { Router } from "express";
import { getSettings, saveSettings } from "@monitor/core";
import { adminOnly } from "../auth.js";

export function settingsRoutes(): Router {
  const router = Router();
  router.use(adminOnly);
  
  router.get("/settings", (_req, res) => {
    const settings = getSettings();
    const { password, ...safe } = settings;
    res.json(safe);
  });
  
  router.put("/settings", (req, res) => {
    const updates = req.body;
    delete updates.password;
    saveSettings(updates);
    res.json(getSettings());
  });
  
  return router;
}
