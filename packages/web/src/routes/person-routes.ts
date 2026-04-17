import { Router } from "express";
import {
  createPerson, getPersonById, listPersons, updatePerson,
  createBinding, updateBinding, getBindingsByPersonId, listBindingCandidates,
  getPersonTimeline, getPersonTasks,
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
    const to = Number(req.query.to) || Date.now();
    res.json(getPersonTimeline(req.params.id, from, to));
  });
  
  router.get("/persons/:id/tasks", (req, res) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    res.json(getPersonTasks(req.params.id, page, limit));
  });
  
  router.post("/person-bindings", (req, res) => {
    const binding = createBinding(req.body);
    res.status(201).json(binding);
  });
  
  router.put("/person-bindings/:id", (req, res) => {
    const binding = updateBinding(Number(req.params.id), req.body);
    if (!binding) { res.status(404).json({ error: "not found" }); return; }
    res.json(binding);
  });
  
  router.get("/person-binding-candidates", (_req, res) => {
    res.json(listBindingCandidates());
  });
  
  return router;
}
