import { Router } from "express";
import {
  createPerson, getPersonById, listPersons, updatePerson,
  createBinding, updateBinding, getBindingsByPersonId, listBindingCandidates,
  createPersonFromWizard, getPersonTimeline, getPersonTasks, PersonWizardConflictError,
} from "@monitor/core";

export function personRoutes(): Router {
  const router = Router();
  
  router.get("/persons", (req, res) => {
    const includeArchived = req.query.includeArchived === "true";
    res.json(listPersons({ includeArchived }));
  });
  
  router.post("/persons", (req, res) => {
    const person = createPerson(req.body);
    res.status(201).json(person);
  });

  router.post("/persons/wizard", (req, res) => {
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
    const person = getPersonById(req.params.id);
    if (!person) { res.status(404).json({ error: "not found" }); return; }
    res.json(person);
  });
  
  router.put("/persons/:id", (req, res) => {
    const person = updatePerson(req.params.id, req.body);
    if (!person) { res.status(404).json({ error: "not found" }); return; }
    res.json(person);
  });
  
  router.get("/persons/:id/bindings", (req, res) => {
    res.json(getBindingsByPersonId(req.params.id));
  });
  
  router.get("/persons/:id/timeline", (req, res) => {
    const from = Number(req.query.from) || 0;
    const to = Number(req.query.to) || Math.floor(Date.now() / 1000);
    res.json(getPersonTimeline(req.params.id, from, to));
  });
  
  router.get("/persons/:id/tasks", (req, res) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    res.json(getPersonTasks(req.params.id, page, limit));
  });
  
  router.post("/person-bindings", (req, res) => {
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
  
  router.put("/person-bindings/:id", (req, res) => {
    const binding = updateBinding(Number(req.params.id), req.body);
    if (!binding) { res.status(404).json({ error: "not found" }); return; }
    res.json(binding);
  });
  
  router.get("/person-binding-candidates", (_req, res) => {
    res.json({ candidates: listBindingCandidates() });
  });
  
  return router;
}
