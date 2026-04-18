import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const SNAPSHOT_COLUMNS = [
  'id',
  'server_id',
  'timestamp',
  'tier',
  'seq',
  'cpu',
  'memory',
  'disks',
  'disk_io',
  'network',
  'processes',
  'processes_by_user',
  'local_users',
];

const LEGACY_PERSON_BINDINGS_UNIQUE = 'UNIQUE (server_id, system_user)';
const ACTIVE_PERSON_BINDINGS_INDEX = 'idx_person_bindings_active_unique';

let db: Database.Database | null = null;

export function getDatabase(dataDir?: string): Database.Database {
  if (db) return db;

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

  if (needsDatabaseReset(dbPath)) {
    moveInvalidDatabaseFiles(dbPath);
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
      agent_id TEXT UNIQUE NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      tier TEXT NOT NULL,
      seq INTEGER,
      cpu TEXT NOT NULL,
      memory TEXT NOT NULL,
      disks TEXT NOT NULL,
      disk_io TEXT NOT NULL,
      network TEXT NOT NULL,
      processes TEXT NOT NULL,
      processes_by_user TEXT NOT NULL,
      local_users TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_query ON snapshots (server_id, tier, timestamp);

    CREATE TABLE IF NOT EXISTS gpu_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
      server_id TEXT NOT NULL,
      gpu_index INTEGER NOT NULL,
      name TEXT NOT NULL,
      temperature INTEGER NOT NULL,
      utilization_gpu INTEGER NOT NULL,
      utilization_memory INTEGER NOT NULL,
      memory_total_mb INTEGER NOT NULL,
      memory_used_mb INTEGER NOT NULL,
      managed_reserved_mb INTEGER NOT NULL,
      unmanaged_peak_mb INTEGER NOT NULL,
      effective_free_mb INTEGER NOT NULL,
      task_allocations TEXT NOT NULL,
      user_processes TEXT NOT NULL,
      unknown_processes TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gpu_snapshots_query ON gpu_snapshots (server_id, gpu_index, snapshot_id);

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      status TEXT NOT NULL,
      command TEXT NOT NULL,
      cwd TEXT NOT NULL,
      user TEXT NOT NULL,
      launch_mode TEXT NOT NULL,
      require_vram_mb INTEGER NOT NULL,
      require_gpu_count INTEGER NOT NULL,
      gpu_ids TEXT,
      priority INTEGER NOT NULL DEFAULT 10,
      created_at REAL NOT NULL,
      started_at REAL,
      finished_at REAL,
      pid INTEGER,
      exit_code INTEGER,
      assigned_gpus TEXT,
      declared_vram_per_gpu INTEGER,
      schedule_history TEXT,
      end_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_server_status ON tasks (server_id, status);
    CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks (user, created_at);

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      value REAL,
      threshold REAL,
      fingerprint TEXT NOT NULL DEFAULT '',
      details TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (server_id, alert_type, fingerprint)
    );

    CREATE TABLE IF NOT EXISTS alert_transitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id INTEGER NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
      from_status TEXT NOT NULL,
      to_status TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'detection',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alert_transitions_alert ON alert_transitions (alert_id, created_at);

    CREATE TABLE IF NOT EXISTS security_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      details TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      resolved_by TEXT,
      created_at INTEGER NOT NULL,
      resolved_at INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_security_active ON security_events (server_id, event_type, fingerprint) WHERE resolved = 0;

    CREATE TABLE IF NOT EXISTS persons (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      email TEXT,
      qq TEXT,
      note TEXT,
      custom_fields TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS person_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id TEXT NOT NULL REFERENCES persons(id),
      server_id TEXT NOT NULL,
      system_user TEXT NOT NULL,
      source TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      effective_from INTEGER,
      effective_to INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_person_bindings_active_unique ON person_bindings (server_id, system_user) WHERE enabled = 1;

    CREATE TABLE IF NOT EXISTS person_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id TEXT NOT NULL REFERENCES persons(id),
      token_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      note TEXT,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_person_tokens_person ON person_tokens (person_id, status);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function needsDatabaseReset(dbPath: string): boolean {
  if (!fs.existsSync(dbPath)) {
    return false;
  }

  let probe: Database.Database | null = null;
  try {
    probe = new Database(dbPath, { readonly: true, fileMustExist: true });
    const snapshotsExists = probe
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='snapshots' LIMIT 1")
      .get();

    if (!snapshotsExists) {
      return false;
    }

    const columns = probe.prepare('PRAGMA table_info(snapshots)').all() as Array<{ name: string }>;
    const names = columns.map((column) => column.name);
    if (names.length !== SNAPSHOT_COLUMNS.length || names.some((name, index) => name !== SNAPSHOT_COLUMNS[index])) {
      return true;
    }

    return hasLegacyPersonBindingsSchema(probe);
  } catch {
    return true;
  } finally {
    probe?.close();
  }
}

function moveInvalidDatabaseFiles(dbPath: string): void {
  const invalidDir = path.join(path.dirname(dbPath), 'invalid-db');
  if (!fs.existsSync(invalidDir)) {
    fs.mkdirSync(invalidDir, { recursive: true });
  }

  const stamp = new Date().toISOString().replace(/[.:]/g, '-');
  const baseName = path.basename(dbPath);
  const targets = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`];

  for (const source of targets) {
    if (!fs.existsSync(source)) {
      continue;
    }
    const suffix = source.slice(dbPath.length);
    const destination = path.join(invalidDir, `${baseName}.${stamp}${suffix}`);
    fs.renameSync(source, destination);
  }
}

function hasLegacyPersonBindingsSchema(db: Database.Database): boolean {
  const table = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'person_bindings'"
  ).get() as { sql?: string } | undefined;

  if (!table?.sql) {
    return false;
  }

  if (table.sql.includes(LEGACY_PERSON_BINDINGS_UNIQUE)) {
    return true;
  }

  const index = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ? LIMIT 1"
  ).get(ACTIVE_PERSON_BINDINGS_INDEX);

  return !index;
}
