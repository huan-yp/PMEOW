import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

interface SchemaColumn {
  name: string;
  definition: string;
}

let db: Database.Database | null = null;

export function getDatabase(dataDir?: string): Database.Database {
  if (db) return db;

  // Support MONITOR_DB_PATH env for Docker deployments
  const envDbPath = process.env.MONITOR_DB_PATH;
  let dbPath: string;

  if (envDbPath) {
    const dir = path.dirname(envDbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    dbPath = envDbPath;
  } else {
    const dir = dataDir || path.join(process.cwd(), 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    dbPath = path.join(dir, 'monitor.db');
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initSchema(db);
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 22,
      username TEXT NOT NULL,
      privateKeyPath TEXT NOT NULL,
      sourceType TEXT NOT NULL DEFAULT 'ssh',
      agentId TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serverId TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      data TEXT NOT NULL,
      FOREIGN KEY (serverId) REFERENCES servers(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_metrics_server_time
      ON metrics(serverId, timestamp);

    CREATE TABLE IF NOT EXISTS hooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      conditionJson TEXT NOT NULL,
      actionJson TEXT NOT NULL,
      lastTriggeredAt INTEGER,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hook_logs (
      id TEXT PRIMARY KEY,
      hookId TEXT NOT NULL,
      triggeredAt INTEGER NOT NULL,
      success INTEGER NOT NULL,
      result TEXT NOT NULL DEFAULT '',
      error TEXT,
      FOREIGN KEY (hookId) REFERENCES hooks(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_hook_logs_hook_time
      ON hook_logs(hookId, triggeredAt);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alert_history (
      id TEXT PRIMARY KEY,
      serverId TEXT NOT NULL,
      serverName TEXT NOT NULL,
      metric TEXT NOT NULL,
      value REAL NOT NULL,
      threshold REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      suppressedUntil INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_alert_history_time
      ON alert_history(timestamp);

    CREATE TABLE IF NOT EXISTS agent_tasks (
      taskId TEXT PRIMARY KEY,
      serverId TEXT NOT NULL,
      status TEXT NOT NULL,
      command TEXT,
      cwd TEXT,
      user TEXT,
      requireVramMB INTEGER,
      requireGpuCount INTEGER,
      gpuIdsJson TEXT,
      priority INTEGER,
      createdAt INTEGER,
      startedAt INTEGER,
      finishedAt INTEGER,
      exitCode INTEGER,
      pid INTEGER,
      updatedAt INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_tasks_server_updated_at
      ON agent_tasks(serverId, updatedAt DESC);

    CREATE TABLE IF NOT EXISTS gpu_usage_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serverId TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      gpuIndex INTEGER NOT NULL,
      ownerType TEXT NOT NULL,
      ownerId TEXT,
      userName TEXT,
      taskId TEXT,
      pid INTEGER,
      usedMemoryMB REAL NOT NULL,
      declaredVramMB REAL
    );

    CREATE INDEX IF NOT EXISTS idx_gpu_usage_stats_server_time
      ON gpu_usage_stats(serverId, timestamp DESC);

    CREATE INDEX IF NOT EXISTS idx_gpu_usage_stats_server_gpu_time
      ON gpu_usage_stats(serverId, gpuIndex, timestamp DESC);
  `);

  ensureColumns(db, 'servers', [
    { name: 'sourceType', definition: "TEXT NOT NULL DEFAULT 'ssh'" },
    { name: 'agentId', definition: 'TEXT' },
  ]);

  ensureColumns(db, 'agent_tasks', [
    { name: 'serverId', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'status', definition: "TEXT NOT NULL DEFAULT 'queued'" },
    { name: 'command', definition: 'TEXT' },
    { name: 'cwd', definition: 'TEXT' },
    { name: 'user', definition: 'TEXT' },
    { name: 'requireVramMB', definition: 'INTEGER' },
    { name: 'requireGpuCount', definition: 'INTEGER' },
    { name: 'gpuIdsJson', definition: 'TEXT' },
    { name: 'priority', definition: 'INTEGER' },
    { name: 'createdAt', definition: 'INTEGER' },
    { name: 'startedAt', definition: 'INTEGER' },
    { name: 'finishedAt', definition: 'INTEGER' },
    { name: 'exitCode', definition: 'INTEGER' },
    { name: 'pid', definition: 'INTEGER' },
    { name: 'updatedAt', definition: 'INTEGER NOT NULL DEFAULT 0' },
  ]);

  ensureColumns(db, 'gpu_usage_stats', [
    { name: 'serverId', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'timestamp', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'gpuIndex', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'ownerType', definition: "TEXT NOT NULL DEFAULT 'unknown'" },
    { name: 'ownerId', definition: 'TEXT' },
    { name: 'userName', definition: 'TEXT' },
    { name: 'taskId', definition: 'TEXT' },
    { name: 'pid', definition: 'INTEGER' },
    { name: 'usedMemoryMB', definition: 'REAL NOT NULL DEFAULT 0' },
    { name: 'declaredVramMB', definition: 'REAL' },
  ]);
}

function ensureColumns(db: Database.Database, tableName: string, columns: SchemaColumn[]): void {
  const existingColumns = new Set(
    (db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[]).map(column => column.name)
  );

  for (const column of columns) {
    if (!existingColumns.has(column.name)) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${column.name} ${column.definition}`);
    }
  }
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
