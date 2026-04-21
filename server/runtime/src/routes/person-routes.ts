import { Router } from "express";
import {
  createPerson, getPersonById, listPersons, updatePerson,
  createBinding, updateBinding, getBindingsByPersonId, listBindingCandidates,
  createPersonFromWizard, getPersonTimeline, getPersonTasks, getPersonDirectory, PersonWizardConflictError,
  autoAddUnassignedUsers,
  createPersonToken, getPersonTokenById, getPersonTokensByPersonId, revokePersonToken, rotatePersonToken,
} from "@pmeow/core";
import type { PersonTokenRecord, TaskRecord } from "@pmeow/core";
import { adminOnly, canAccessPersonId } from "../auth.js";
import { parsePagination } from "./pagination.js";

export function personRoutes(): Router {
  const router = Router();
  
  router.get("/persons", (req, res) => {
    if (!req.principal) {
      res.status(401).json({ error: "未认证" });
      return;
    }

    if (req.principal.kind === "person") {
      const person = getPersonById(req.principal.personId);
      res.json(person ? [person] : []);
      return;
    }

    const includeArchived = req.query.includeArchived === "true";
    res.json(listPersons({ includeArchived }));
  });

  router.get("/persons/directory", adminOnly, (_req, res) => {
    res.json(getPersonDirectory());
  });
  
  router.post("/persons", adminOnly, (req, res) => {
    const person = createPerson(req.body);
    res.status(201).json(person);
  });

  router.post("/persons/wizard", adminOnly, (req, res) => {
    try {
      const result = createPersonFromWizard(req.body);
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof PersonWizardConflictError) {
        res.status(409).json({
          error: "binding_conflict",
          message: "所选系统账号已绑定给其他人员，请确认迁移后重试。",
          conflicts: error.conflicts,
        });
        return;
      }

      res.status(400).json({
        error: "invalid_person_wizard_request",
        message: error instanceof Error ? error.message : "Invalid person wizard request",
      });
    }
  });
  
  router.get("/persons/:id", (req, res) => {
    if (!canAccessPersonId(req.principal, req.params.id)) {
      res.status(403).json({ error: "无权访问该人员" });
      return;
    }

    const person = getPersonById(req.params.id);
    if (!person) { res.status(404).json({ error: "not found" }); return; }
    res.json(person);
  });
  
  router.put("/persons/:id", (req, res) => {
    if (!canAccessPersonId(req.principal, req.params.id)) {
      res.status(403).json({ error: "无权修改该人员" });
      return;
    }

    const payload = req.principal?.kind === "admin"
      ? req.body
      : {
          email: typeof req.body?.email === "string" ? req.body.email : undefined,
          qq: typeof req.body?.qq === "string" ? req.body.qq : undefined,
        };
    const person = updatePerson(req.params.id, payload);
    if (!person) { res.status(404).json({ error: "not found" }); return; }
    res.json(person);
  });
  
  router.get("/persons/:id/bindings", (req, res) => {
    if (!canAccessPersonId(req.principal, req.params.id)) {
      res.status(403).json({ error: "无权访问该人员" });
      return;
    }

    res.json(getBindingsByPersonId(req.params.id));
  });
  
  router.get("/persons/:id/timeline", (req, res) => {
    if (!canAccessPersonId(req.principal, req.params.id)) {
      res.status(403).json({ error: "无权访问该人员" });
      return;
    }

    const from = Number(req.query.from) || 0;
    const to = Number(req.query.to) || Math.floor(Date.now() / 1000);
    res.json(getPersonTimeline(req.params.id, from, to));
  });
  
  router.get("/persons/:id/tasks", (req, res) => {
    if (!canAccessPersonId(req.principal, req.params.id)) {
      res.status(403).json({ error: "无权访问该人员" });
      return;
    }

    const { page, limit } = parsePagination(req.query);
    const result = getPersonTasks(req.params.id, page, limit);
    res.json({
      tasks: result.tasks.map(toApiTask),
      total: result.total,
    });
  });
  
  router.post("/person-bindings", adminOnly, (req, res) => {
    try {
      const binding = createBinding(req.body);
      res.status(201).json(binding);
    } catch (error) {
      res.status(409).json({
        error: "binding_conflict",
        message: error instanceof Error ? error.message : "Binding conflict",
      });
    }
  });
  
  router.put("/person-bindings/:id", adminOnly, (req, res) => {
    const binding = updateBinding(Number(req.params.id), req.body);
    if (!binding) { res.status(404).json({ error: "not found" }); return; }
    res.json(binding);
  });
  
  router.get("/person-binding-candidates", adminOnly, (_req, res) => {
    res.json({ candidates: listBindingCandidates() });
  });

  router.post("/persons/auto-add", adminOnly, (_req, res) => {
    const report = autoAddUnassignedUsers();
    res.json(report);
  });

  router.get("/persons/:id/tokens", (req, res) => {
    if (!canAccessPersonId(req.principal, req.params.id)) {
      res.status(403).json({ error: "无权访问该人员" });
      return;
    }

    const tokens = getPersonTokensByPersonId(req.params.id as string);
    res.json(tokens.map(sanitizeToken));
  });

  router.post("/persons/:id/tokens", (req, res) => {
    if (!canAccessPersonId(req.principal, req.params.id)) {
      res.status(403).json({ error: "无权访问该人员" });
      return;
    }

    const person = getPersonById(req.params.id as string);
    if (!person) { res.status(404).json({ error: "not found" }); return; }
    const note = typeof req.body?.note === 'string' ? req.body.note : null;
    const { record, plainToken } = createPersonToken(person.id, note);
    res.status(201).json({ ...sanitizeToken(record), plainToken });
  });

  router.post("/person-tokens/:id/revoke", (req, res) => {
    const current = getPersonTokenById(Number(req.params.id));
    if (!current) { res.status(404).json({ error: "not found" }); return; }
    if (!canAccessPersonId(req.principal, current.personId)) {
      res.status(403).json({ error: "无权访问该令牌" });
      return;
    }

    const token = revokePersonToken(Number(req.params.id));
    if (!token) { res.status(404).json({ error: "not found" }); return; }
    res.json(sanitizeToken(token));
  });

  router.post("/person-tokens/:id/rotate", (req, res) => {
    const current = getPersonTokenById(Number(req.params.id));
    if (!current) { res.status(404).json({ error: "not found" }); return; }
    if (!canAccessPersonId(req.principal, current.personId)) {
      res.status(403).json({ error: "无权访问该令牌" });
      return;
    }

    const note = typeof req.body?.note === 'string' ? req.body.note : null;
    const result = rotatePersonToken(Number(req.params.id), note);
    if (!result) { res.status(404).json({ error: "not found" }); return; }
    res.json({ ...sanitizeToken(result.record), plainToken: result.plainToken });
  });

  return router;
}

function toApiTask(task: TaskRecord) {
  return {
    ...task,
    gpuIds: task.gpuIds ? JSON.parse(task.gpuIds) : null,
    assignedGpus: task.assignedGpus ? JSON.parse(task.assignedGpus) : null,
    scheduleHistory: task.scheduleHistory ? JSON.parse(task.scheduleHistory) : null,
  };
}

function sanitizeToken(token: PersonTokenRecord): Omit<PersonTokenRecord, 'tokenHash'> & { tokenHash?: never } {
  const { tokenHash, ...rest } = token;
  return rest;
}
