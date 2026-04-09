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
      command TEXT,
      usedMemoryMB REAL NOT NULL,
      declaredVramMB REAL
    );

    CREATE INDEX IF NOT EXISTS idx_gpu_usage_stats_server_time
      ON gpu_usage_stats(serverId, timestamp DESC);

    CREATE INDEX IF NOT EXISTS idx_gpu_usage_stats_server_gpu_time
      ON gpu_usage_stats(serverId, gpuIndex, timestamp DESC);

    CREATE INDEX IF NOT EXISTS idx_gpu_usage_stats_user_time
      ON gpu_usage_stats(userName, timestamp DESC);

    CREATE INDEX IF NOT EXISTS idx_gpu_usage_stats_task_time
      ON gpu_usage_stats(taskId, timestamp DESC);

    CREATE TABLE IF NOT EXISTS security_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serverId TEXT NOT NULL,
      eventType TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      detailsJson TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      resolvedBy TEXT,
      createdAt INTEGER NOT NULL,
      resolvedAt INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_security_events_server_created_at
      ON security_events(serverId, createdAt DESC);

    CREATE INDEX IF NOT EXISTS idx_security_events_resolved_created_at
      ON security_events(resolved, createdAt DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_security_events_open_fingerprint
      ON security_events(serverId, eventType, fingerprint)
      WHERE resolved = 0;

    CREATE TABLE IF NOT EXISTS persons (
      id TEXT PRIMARY KEY,
      displayName TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      qq TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      customFieldsJson TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS person_bindings (
      id TEXT PRIMARY KEY,
      personId TEXT NOT NULL,
      serverId TEXT NOT NULL,
      systemUser TEXT NOT NULL,
      source TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      effectiveFrom INTEGER NOT NULL,
      effectiveTo INTEGER,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY (personId) REFERENCES persons(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_person_bindings_active_unique
      ON person_bindings(serverId, systemUser)
      WHERE enabled = 1 AND effectiveTo IS NULL;

    CREATE TABLE IF NOT EXISTS task_owner_overrides (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      serverId TEXT NOT NULL,
      personId TEXT NOT NULL,
      source TEXT NOT NULL,
      effectiveFrom INTEGER NOT NULL,
      effectiveTo INTEGER,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY (personId) REFERENCES persons(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS person_attribution_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      sourceType TEXT NOT NULL,
      serverId TEXT NOT NULL,
      personId TEXT,
      rawUser TEXT,
      taskId TEXT,
      gpuIndex INTEGER,
      vramMB REAL,
      taskStatus TEXT,
      resolutionSource TEXT NOT NULL,
      metadataJson TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS server_local_users (
      serverId TEXT NOT NULL,
      username TEXT NOT NULL,
      uid INTEGER NOT NULL,
      gid INTEGER NOT NULL,
      gecos TEXT NOT NULL DEFAULT '',
      home TEXT NOT NULL DEFAULT '',
      shell TEXT NOT NULL DEFAULT '',
      updatedAt INTEGER NOT NULL,
      PRIMARY KEY (serverId, username),
      FOREIGN KEY (serverId) REFERENCES servers(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_server_local_users_server_updated
      ON server_local_users(serverId, updatedAt DESC);

    CREATE INDEX IF NOT EXISTS idx_server_local_users_username
      ON server_local_users(username);

    CREATE TABLE IF NOT EXISTS person_mobile_tokens (
      id TEXT PRIMARY KEY,
      personId TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      tokenHash TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      rotatedAt INTEGER,
      revokedAt INTEGER,
      lastUsedAt INTEGER,
      FOREIGN KEY (personId) REFERENCES persons(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS person_mobile_preferences (
      personId TEXT PRIMARY KEY,
      notifyTaskStarted INTEGER NOT NULL DEFAULT 1,
      notifyTaskCompleted INTEGER NOT NULL DEFAULT 1,
      notifyTaskFailed INTEGER NOT NULL DEFAULT 1,
      notifyTaskCancelled INTEGER NOT NULL DEFAULT 1,
      notifyNodeStatus INTEGER NOT NULL DEFAULT 1,
      notifyGpuAvailable INTEGER NOT NULL DEFAULT 0,
      minAvailableGpuCount INTEGER NOT NULL DEFAULT 1,
      minAvailableVramGB REAL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY (personId) REFERENCES persons(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS person_mobile_notifications (
      id TEXT PRIMARY KEY,
      personId TEXT NOT NULL,
      category TEXT NOT NULL,
      eventType TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      payloadJson TEXT NOT NULL DEFAULT '{}',
      dedupeKey TEXT NOT NULL DEFAULT '',
      createdAt INTEGER NOT NULL,
      readAt INTEGER,
      FOREIGN KEY (personId) REFERENCES persons(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_person_mobile_notifications_person_created
      ON person_mobile_notifications(personId, createdAt DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_person_mobile_notifications_dedupe
      ON person_mobile_notifications(personId, dedupeKey)
      WHERE dedupeKey != '';

    CREATE TABLE IF NOT EXISTS server_status_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serverId TEXT NOT NULL,
      fromStatus TEXT NOT NULL,
      toStatus TEXT NOT NULL,
      reason TEXT,
      lastSeen INTEGER NOT NULL,
      createdAt INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_server_status_events_server_created
      ON server_status_events(serverId, createdAt DESC);

    CREATE INDEX IF NOT EXISTS idx_server_status_events_created
      ON server_status_events(createdAt DESC);
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
    { name: 'command', definition: 'TEXT' },
    { name: 'usedMemoryMB', definition: 'REAL NOT NULL DEFAULT 0' },
    { name: 'declaredVramMB', definition: 'REAL' },
  ]);

  ensureColumns(db, 'security_events', [
    { name: 'serverId', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'eventType', definition: "TEXT NOT NULL DEFAULT 'suspicious_process'" },
    { name: 'fingerprint', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'detailsJson', definition: "TEXT NOT NULL DEFAULT '{}'" },
    { name: 'resolved', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'resolvedBy', definition: 'TEXT' },
    { name: 'createdAt', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'resolvedAt', definition: 'INTEGER' },
  ]);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_gpu_usage_stats_user_time
      ON gpu_usage_stats(userName, timestamp DESC);

    CREATE INDEX IF NOT EXISTS idx_gpu_usage_stats_task_time
      ON gpu_usage_stats(taskId, timestamp DESC);

    CREATE INDEX IF NOT EXISTS idx_security_events_server_created_at
      ON security_events(serverId, createdAt DESC);

    CREATE INDEX IF NOT EXISTS idx_security_events_resolved_created_at
      ON security_events(resolved, createdAt DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_security_events_open_fingerprint
      ON security_events(serverId, eventType, fingerprint)
      WHERE resolved = 0;
  `);

  // Fix historical marked_safe audit events that were incorrectly left as unresolved.
  // Each marked_safe event references the original event via targetEventId in detailsJson.
  // We resolve them by copying resolvedBy/resolvedAt from the original event.
  db.exec(`
    UPDATE security_events
    SET resolved = 1,
        resolvedBy = (
          SELECT se2.resolvedBy
          FROM security_events se2
          WHERE se2.id = CAST(json_extract(security_events.detailsJson, '$.targetEventId') AS INTEGER)
        ),
        resolvedAt = (
          SELECT se2.resolvedAt
          FROM security_events se2
          WHERE se2.id = CAST(json_extract(security_events.detailsJson, '$.targetEventId') AS INTEGER)
        )
    WHERE eventType = 'marked_safe'
      AND resolved = 0
  `);
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
