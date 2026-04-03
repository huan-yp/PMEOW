import {
  createPerson,
  createPersonBinding,
  getPersonById,
  getPersonSummaries,
  getPersonTimeline,
  getPersonTasks,
  getServerPersonActivity,
  listPersonBindingSuggestions,
  listPersons,
  listPersonBindings,
  updatePerson,
  updatePersonBinding,
} from '@monitor/core';
import type { Express } from 'express';

export function setupPersonRoutes(app: Express): void {
  app.get('/api/persons', (_req, res) => res.json(listPersons({ includeArchived: true })));

  app.get('/api/persons/summary', (req, res) => res.json(getPersonSummaries(Number(req.query.hours ?? 168))));

  app.get('/api/person-binding-suggestions', (_req, res) => res.json(listPersonBindingSuggestions()));

  app.post('/api/persons', (req, res) => res.json(createPerson(req.body)));

  app.get('/api/persons/:id', (req, res) => {
    const person = getPersonById(req.params.id);
    if (!person) return res.status(404).json({ error: 'Person not found' });
    res.json(person);
  });

  app.put('/api/persons/:id', (req, res) => res.json(updatePerson(req.params.id, req.body)));

  app.get('/api/persons/:id/bindings', (req, res) => res.json(listPersonBindings(req.params.id)));

  app.get('/api/persons/:id/timeline', (req, res) => res.json(getPersonTimeline(req.params.id, Number(req.query.hours ?? 168))));

  app.get('/api/persons/:id/tasks', (req, res) => res.json(getPersonTasks(req.params.id, Number(req.query.hours ?? 168))));

  app.post('/api/person-bindings', (req, res) => res.json(createPersonBinding(req.body)));

  app.put('/api/person-bindings/:id', (req, res) => res.json(updatePersonBinding(req.params.id, req.body)));

  app.get('/api/servers/:id/person-activity', (req, res) => res.json(getServerPersonActivity(req.params.id)));
}
