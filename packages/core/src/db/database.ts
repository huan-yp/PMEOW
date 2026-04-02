import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

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
  `);

  // Migrate existing databases: add sourceType and agentId columns if missing
  const cols = db.prepare("PRAGMA table_info(servers)").all() as { name: string }[];
  const colNames = new Set(cols.map(c => c.name));
  if (!colNames.has('sourceType')) {
    db.exec("ALTER TABLE servers ADD COLUMN sourceType TEXT NOT NULL DEFAULT 'ssh'");
  }
  if (!colNames.has('agentId')) {
    db.exec("ALTER TABLE servers ADD COLUMN agentId TEXT");
  }
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
