import { Router } from "express";
import { getSettings, saveSettings } from "@pmeow/core";
import { adminOnly } from "../auth.js";

export function settingsRoutes(): Router {
  const router = Router();

  router.get("/settings", adminOnly, (_req, res) => {
    const settings = getSettings();
    const { password, ...safe } = settings;
    res.json(safe);
  });

  router.put("/settings", adminOnly, (req, res) => {
    const updates = req.body;
    delete updates.password;
    saveSettings(updates);
    res.json(getSettings());
  });

  return router;
}
