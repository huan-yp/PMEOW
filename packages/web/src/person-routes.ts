import {
  createPerson,
  createPersonBinding,
  getPersonById,
  listPersonBindingCandidates,
  getPersonSummaries,
  getPersonTimeline,
  getPersonTasks,
  getServerPersonActivity,
  getPersonNodeDistribution,
  getPersonPeakPeriods,
  listPersonBindingSuggestions,
  listPersons,
  listPersonBindings,
  updatePerson,
  updatePersonBinding,
  createPersonMobileToken,
  rotatePersonMobileToken,
  revokePersonMobileToken,
  getPersonMobileTokenStatus,
} from '@monitor/core';
import type { Express } from 'express';

export function setupPersonRoutes(app: Express): void {
  app.get('/api/persons', (_req, res) => res.json(listPersons({ includeArchived: true })));

  app.get('/api/persons/summary', (req, res) => res.json(getPersonSummaries(Number(req.query.hours ?? 168))));

  app.get('/api/person-binding-candidates', (_req, res) => res.json(listPersonBindingCandidates()));

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

  app.get('/api/persons/:id/node-distribution', (req, res) => res.json(getPersonNodeDistribution(req.params.id, Number(req.query.hours ?? 168))));

  app.get('/api/persons/:id/peak-periods', (req, res) => res.json(getPersonPeakPeriods(req.params.id, Number(req.query.hours ?? 168), Number(req.query.top ?? 3))));

  app.post('/api/person-bindings', (req, res) => res.json(createPersonBinding(req.body)));

  app.put('/api/person-bindings/:id', (req, res) => res.json(updatePersonBinding(req.params.id, req.body)));

  app.get('/api/servers/:id/person-activity', (req, res) => res.json(getServerPersonActivity(req.params.id)));

  // Person mobile token lifecycle (admin-only)
  app.post('/api/persons/:id/mobile-token', (req, res) => {
    const person = getPersonById(req.params.id);
    if (!person) return res.status(404).json({ error: 'Person not found' });
    const result = createPersonMobileToken(person.id, req.body?.label ?? '');
    res.json({ id: result.record.id, plainToken: result.plainToken, createdAt: result.record.createdAt });
  });

  app.post('/api/persons/:id/mobile-token/rotate', (req, res) => {
    const person = getPersonById(req.params.id);
    if (!person) return res.status(404).json({ error: 'Person not found' });
    const result = rotatePersonMobileToken(person.id);
    if (!result) return res.status(500).json({ error: 'Failed to rotate token' });
    res.json({ id: result.record.id, plainToken: result.plainToken, createdAt: result.record.createdAt });
  });

  app.delete('/api/persons/:id/mobile-token', (req, res) => {
    const person = getPersonById(req.params.id);
    if (!person) return res.status(404).json({ error: 'Person not found' });
    revokePersonMobileToken(person.id);
    res.json({ success: true });
  });

  app.get('/api/persons/:id/mobile-token/status', (req, res) => {
    const status = getPersonMobileTokenStatus(req.params.id);
    res.json(status ? { hasToken: true, createdAt: status.createdAt, lastUsedAt: status.lastUsedAt } : { hasToken: false });
  });
}
