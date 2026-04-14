import type { Namespace } from 'socket.io';
import type { Scheduler } from '@monitor/core';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { hashPassword } from './auth.js';
import {
  getAllServers, getServerById, createServer, updateServer, deleteServer,
  getLatestMetrics, getMetricsHistory,
  getAllHooks, createHook, updateHook, deleteHook, getHookLogs,
  getSettings, saveSettings,
  setAlertCallback, setHookTriggeredCallback, setNotifyCallback,
  SSHManager,
  getAlerts, suppressAlert, unsuppressAlert, batchSuppressAlerts, batchUnsuppressAlerts,
} from '@monitor/core';
import type { ServerInput, HookRuleInput } from '@monitor/core';

export function setupSocketHandlers(io: Namespace, scheduler: Scheduler): void {
  // Forward core events to all authenticated clients
  scheduler.on('metricsUpdate', (data) => {
    io.emit('metricsUpdate', data);
  });

  scheduler.on('serverStatus', (status) => {
    io.emit('serverStatus', status);
  });

  scheduler.on('securityEvent', (event) => {
    io.emit('securityEvent', event);
  });

  setAlertCallback((alert) => {
    io.emit('alert', alert);
  });

  setHookTriggeredCallback((log) => {
    io.emit('hookTriggered', log);
  });

  setNotifyCallback((_title, _body) => {
    // In web mode, notifications are sent as alerts to the frontend
    // Desktop notifications are only for Electron
  });
}

/** REST API route setup  */
export function setupRestRoutes(app: any, scheduler: Scheduler): void {
  // ---------- Servers ----------
  app.get('/api/servers', (_req: any, res: any) => {
    res.json(getAllServers());
  });

  app.get('/api/servers/:id', (req: any, res: any) => {
    const s = getServerById(req.params.id);
    if (!s) return res.status(404).json({ error: '服务器不存在' });
    res.json(s);
  });

  app.post('/api/servers', (req: any, res: any) => {
    const input: ServerInput = req.body;
    if (!input.host || !input.username || !input.privateKeyPath) {
      return res.status(400).json({ error: '缺少必要字段' });
    }
    const server = createServer(input);
    res.json(server);
    scheduler.initDataSources();
  });

  app.put('/api/servers/:id', (req: any, res: any) => {
    const server = updateServer(req.params.id, req.body);
    if (!server) return res.status(404).json({ error: '服务器不存在' });
    res.json(server);
    scheduler.initDataSources();
  });

  app.delete('/api/servers/:id', (req: any, res: any) => {
    const ds = scheduler.getDataSource(req.params.id);
    if (ds) ds.disconnect();
    deleteServer(req.params.id);
    scheduler.initDataSources();
    res.json({ ok: true });
  });

  // Test connection with raw ServerInput (unsaved server)
  app.post('/api/servers/test', async (req: any, res: any) => {
    const input: ServerInput = req.body;
    if (!input.host || !input.username || !input.privateKeyPath) {
      return res.status(400).json({ success: false, error: '缺少必要字段' });
    }
    const ssh = new SSHManager();
    try {
      const keyBuffer = fs.readFileSync(input.privateKeyPath.replace(/^~/, process.env.HOME || '/root'));
      const tempConfig = { ...input, id: '__test__', sourceType: 'ssh' as const, agentId: null, createdAt: 0, updatedAt: 0 };
      await ssh.connect(tempConfig, keyBuffer);
      const result = await ssh.exec('__test__', 'hostname');
      ssh.disconnect('__test__');
      res.json({ success: true, hostname: result.trim() });
    } catch (err: any) {
      ssh.disconnect('__test__');
      res.json({ success: false, error: err?.message ?? '连接失败' });
    }
  });

  app.post('/api/servers/:id/test', async (req: any, res: any) => {
    try {
      const snapshot = await scheduler.collectServer(req.params.id);
      if (snapshot) {
        res.json({ ok: true, hostname: snapshot.system.hostname });
      } else {
        res.status(500).json({ ok: false, error: '连接失败' });
      }
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? '未知错误' });
    }
  });

  // ---------- Metrics ----------
  app.get('/api/metrics/latest', (_req: any, res: any) => {
    const servers = getAllServers();
    const result: Record<string, any> = {};
    for (const s of servers) {
      const m = getLatestMetrics(s.id);
      if (m) result[s.id] = m;
    }
    res.json(result);
  });

  app.get('/api/metrics/:serverId/history', (req: any, res: any) => {
    const hours = Number(req.query.hours) || 24;
    const to = Date.now();
    const from = to - hours * 3600 * 1000;
    const metrics = getMetricsHistory(req.params.serverId, from, to);
    res.json(metrics);
  });

  // ---------- Server Statuses ----------
  app.get('/api/statuses', (_req: any, res: any) => {
    res.json(scheduler.getAllStatuses());
  });

  // ---------- Hooks ----------
  app.get('/api/hooks', (_req: any, res: any) => {
    res.json(getAllHooks());
  });

  app.post('/api/hooks', (req: any, res: any) => {
    const input: HookRuleInput = req.body;
    const hook = createHook(input);
    res.json(hook);
  });

  app.put('/api/hooks/:id', (req: any, res: any) => {
    const hook = updateHook(req.params.id, req.body);
    if (!hook) return res.status(404).json({ error: '规则不存在' });
    res.json(hook);
  });

  app.delete('/api/hooks/:id', (req: any, res: any) => {
    deleteHook(req.params.id);
    res.json({ ok: true });
  });

  app.get('/api/hooks/:id/logs', (req: any, res: any) => {
    const limit = Number(req.query.limit) || 50;
    res.json(getHookLogs(req.params.id, limit));
  });

  // ---------- Settings ----------
  app.get('/api/settings', (_req: any, res: any) => {
    const s = getSettings();
    // Don't send password hash to client
    const { password: _pw, ...safe } = s;
    res.json(safe);
  });

  app.put('/api/settings', (req: any, res: any) => {
    const nextSettings = { ...(req.body ?? {}) };

    if ('password' in nextSettings) {
      const password = typeof nextSettings.password === 'string'
        ? nextSettings.password.trim()
        : '';

      if (password) {
        nextSettings.password = hashPassword(password);
      } else {
        delete nextSettings.password;
      }
    }

    saveSettings(nextSettings);
    // If refreshInterval changed, restart scheduler
    scheduler.restart();
    res.json({ ok: true });
  });

  // ---------- Alerts ----------
  app.get('/api/alerts', (req: any, res: any) => {
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    let suppressed: boolean | undefined;
    if (req.query.suppressed === 'true') suppressed = true;
    else if (req.query.suppressed === 'false') suppressed = false;
    res.json(getAlerts({ limit, offset, suppressed }));
  });

  // Batch routes must be registered before the :id wildcard routes
  app.post('/api/alerts/batch/suppress', (req: any, res: any) => {
    const ids: unknown = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) {
      res.status(400).json({ error: '缺少 ids 参数' });
      return;
    }
    const settings = getSettings();
    const days = Number(req.body.days) || settings.alertSuppressDefaultDays || 7;
    const untilMs = Date.now() + days * 24 * 60 * 60 * 1000;
    batchSuppressAlerts(ids as string[], untilMs);
    res.json({ ok: true });
  });

  app.post('/api/alerts/batch/unsuppress', (req: any, res: any) => {
    const ids: unknown = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) {
      res.status(400).json({ error: '缺少 ids 参数' });
      return;
    }
    batchUnsuppressAlerts(ids as string[]);
    res.json({ ok: true });
  });

  app.post('/api/alerts/:id/suppress', (req: any, res: any) => {
    const settings = getSettings();
    const days = Number(req.body.days) || settings.alertSuppressDefaultDays || 7;
    const untilMs = Date.now() + days * 24 * 60 * 60 * 1000;
    suppressAlert(req.params.id, untilMs);
    res.json({ ok: true });
  });

  app.post('/api/alerts/:id/unsuppress', (req: any, res: any) => {
    unsuppressAlert(req.params.id);
    res.json({ ok: true });
  });

  // ---------- Key Upload ----------
  const keysDir = path.join(process.cwd(), 'data', 'keys');
  if (!fs.existsSync(keysDir)) fs.mkdirSync(keysDir, { recursive: true });

  const upload = multer({
    dest: keysDir,
    limits: { fileSize: 10 * 1024 }, // 10KB max
    fileFilter: (_req: any, _file: any, cb: any) => cb(null, true),
  });

  app.post('/api/keys/upload', upload.single('key'), (req: any, res: any) => {
    if (!req.file) return res.status(400).json({ error: '未选择文件' });
    // Sanitize: rename to a safe name
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const finalPath = path.join(keysDir, safeName);
    fs.renameSync(req.file.path, finalPath);
    fs.chmodSync(finalPath, 0o600);
    res.json({ path: finalPath });
  });
}
