import { Router } from "express";
import { buildSessionResponse } from "../auth.js";

export function sessionRoutes(): Router {
  const router = Router();

  router.get("/session/me", (req, res) => {
    if (!req.principal) {
      res.status(401).json({ error: "未认证" });
      return;
    }

    res.json(buildSessionResponse(req.principal));
  });

  return router;
}