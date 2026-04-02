# Plan 1: Server Foundation Refactoring

> **For agentic workers:** REQUIRED: Use the `subagent-driven-development` agent (recommended) or `executing-plans` agent to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the server-side architecture to use a NodeDataSource abstraction layer, wrapping existing SSH logic in SSHDataSource, preparing an AgentDataSource stub, and removing Electron — so the system behaves identically to V1 but with clean architecture ready for Agent integration.

**Architecture:** Introduce a `NodeDataSource` interface that abstracts how metrics are collected from a server. `SSHDataSource` wraps the existing SSHManager + collectors. The `Scheduler` is refactored to use `NodeDataSource` instead of calling SSH directly. `ServerConfig` gains `sourceType` and `agentId` fields. Electron package is deleted and UI transport simplified.

**Tech Stack:** TypeScript, better-sqlite3, ssh2, vitest (new), Express, Socket.IO

---

### Task 1: Setup test infrastructure

**Files:**
- Create: `packages/core/vitest.config.ts`
- Modify: `packages/core/package.json`
- Create: `packages/core/tests/setup.ts`
- Create: `packages/core/tests/db/servers.test.ts`

- [ ] **Step 1: Install vitest in core package**

Run:
```bash
cd packages/core && pnpm add -D vitest
```

- [ ] **Step 2: Create vitest config**

Create `packages/core/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Create test setup file**

Create `packages/core/tests/setup.ts`:
```typescript
import { getDatabase, closeDatabase } from '../src/db/database.js';
import { afterEach } from 'vitest';

// Use in-memory database for tests
process.env.MONITOR_DB_PATH = ':memory:';

afterEach(() => {
  closeDatabase();
});
```

- [ ] **Step 4: Add test script to package.json**

In `packages/core/package.json`, add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Write a smoke test for existing server CRUD**

Create `packages/core/tests/db/servers.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { getDatabase } from '../../src/db/database.js';
import { getAllServers, createServer, getServerById, updateServer, deleteServer } from '../../src/db/servers.js';
import type { ServerInput } from '../../src/types.js';

beforeEach(() => {
  getDatabase();
});

const testInput: ServerInput = {
  name: 'test-server',
  host: '192.168.1.1',
  port: 22,
  username: 'root',
  privateKeyPath: '/tmp/test_key',
};

describe('servers CRUD', () => {
  it('should start empty', () => {
    expect(getAllServers()).toEqual([]);
  });

  it('should create and retrieve a server', () => {
    const server = createServer(testInput);
    expect(server.id).toBeDefined();
    expect(server.name).toBe('test-server');
    expect(server.host).toBe('192.168.1.1');

    const found = getServerById(server.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('test-server');
  });

  it('should update a server', () => {
    const server = createServer(testInput);
    const updated = updateServer(server.id, { name: 'renamed' });
    expect(updated!.name).toBe('renamed');
    expect(updated!.host).toBe('192.168.1.1');
  });

  it('should delete a server', () => {
    const server = createServer(testInput);
    expect(deleteServer(server.id)).toBe(true);
    expect(getServerById(server.id)).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run tests to verify setup works**

Run: `cd packages/core && pnpm test`
Expected: 4 passing tests

- [ ] **Step 7: Commit**

```bash
git add packages/core/vitest.config.ts packages/core/tests/ packages/core/package.json pnpm-lock.yaml
git commit -m "chore(core): add vitest test infrastructure with server CRUD smoke tests"
```

---

### Task 2: Add sourceType and agentId to types and ServerConfig

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/tests/db/servers.test.ts`

- [ ] **Step 1: Write test asserting new fields exist on created servers**

Append to `packages/core/tests/db/servers.test.ts`:
```typescript
describe('server sourceType and agentId fields', () => {
  it('should default sourceType to ssh and agentId to null', () => {
    const server = createServer(testInput);
    expect(server.sourceType).toBe('ssh');
    expect(server.agentId).toBeNull();
  });

  it('should allow creating a server with agent sourceType', () => {
    const server = createServer({ ...testInput, sourceType: 'agent', agentId: 'agent-001' });
    expect(server.sourceType).toBe('agent');
    expect(server.agentId).toBe('agent-001');
  });

  it('should update sourceType', () => {
    const server = createServer(testInput);
    const updated = updateServer(server.id, { sourceType: 'agent', agentId: 'agent-002' });
    expect(updated!.sourceType).toBe('agent');
    expect(updated!.agentId).toBe('agent-002');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && pnpm test`
Expected: FAIL — `sourceType` property does not exist on ServerConfig

- [ ] **Step 3: Add SourceType and update ServerConfig in types.ts**

In `packages/core/src/types.ts`, after the existing `ServerConfig` interface, replace:

```typescript
// ========================
// Server Configuration
// ========================

export type SourceType = 'ssh' | 'agent';

export interface ServerConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
  sourceType: SourceType;
  agentId: string | null;
  createdAt: number;
  updatedAt: number;
}

export type ServerInput = Omit<ServerConfig, 'id' | 'createdAt' | 'updatedAt' | 'sourceType' | 'agentId'> & {
  sourceType?: SourceType;
  agentId?: string | null;
};
```

Note: `ServerInput` makes `sourceType` and `agentId` optional so existing call sites don't break. Defaults are applied in `createServer`.

- [ ] **Step 4: Run tests — still failing because DB and CRUD don't handle new fields yet**

Run: `cd packages/core && pnpm test`
Expected: FAIL — TypeScript type errors or DB columns missing

- [ ] **Step 5: Commit types change**

```bash
git add packages/core/src/types.ts packages/core/tests/db/servers.test.ts
git commit -m "feat(core): add sourceType and agentId to ServerConfig type"
```

---

### Task 3: DB schema migration for servers table

**Files:**
- Modify: `packages/core/src/db/database.ts`

- [ ] **Step 1: Add new columns to the servers table schema**

In `packages/core/src/db/database.ts`, in the `initSchema` function, after the existing `CREATE TABLE IF NOT EXISTS servers` statement, add migration logic. Replace the servers CREATE TABLE with:

```sql
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
```

And add migration for existing databases after all CREATE statements:

```typescript
// Migrate existing databases: add sourceType and agentId columns if missing
const cols = db.prepare("PRAGMA table_info(servers)").all() as { name: string }[];
const colNames = new Set(cols.map(c => c.name));
if (!colNames.has('sourceType')) {
  db.exec("ALTER TABLE servers ADD COLUMN sourceType TEXT NOT NULL DEFAULT 'ssh'");
}
if (!colNames.has('agentId')) {
  db.exec("ALTER TABLE servers ADD COLUMN agentId TEXT");
}
```

- [ ] **Step 2: Run tests — should still fail because CRUD doesn't read/write new fields**

Run: `cd packages/core && pnpm test`
Expected: FAIL — createServer doesn't set sourceType/agentId

- [ ] **Step 3: Commit schema migration**

```bash
git add packages/core/src/db/database.ts
git commit -m "feat(core): add sourceType and agentId columns to servers table"
```

---

### Task 4: Update servers CRUD for new fields

**Files:**
- Modify: `packages/core/src/db/servers.ts`

- [ ] **Step 1: Update createServer to handle sourceType and agentId**

Replace the `createServer` function in `packages/core/src/db/servers.ts`:

```typescript
export function createServer(input: ServerInput): ServerConfig {
  const db = getDatabase();
  const now = Date.now();
  const server: ServerConfig = {
    id: randomUUID(),
    ...input,
    sourceType: input.sourceType ?? 'ssh',
    agentId: input.agentId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    'INSERT INTO servers (id, name, host, port, username, privateKeyPath, sourceType, agentId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(server.id, server.name, server.host, server.port, server.username, server.privateKeyPath, server.sourceType, server.agentId, server.createdAt, server.updatedAt);
  return server;
}
```

- [ ] **Step 2: Update updateServer to handle sourceType and agentId**

Replace the `updateServer` function:

```typescript
export function updateServer(id: string, input: Partial<ServerInput>): ServerConfig | undefined {
  const db = getDatabase();
  const existing = getServerById(id);
  if (!existing) return undefined;

  const updated: ServerConfig = {
    ...existing,
    ...input,
    sourceType: input.sourceType ?? existing.sourceType,
    agentId: input.agentId !== undefined ? input.agentId : existing.agentId,
    updatedAt: Date.now(),
  };
  db.prepare(
    'UPDATE servers SET name = ?, host = ?, port = ?, username = ?, privateKeyPath = ?, sourceType = ?, agentId = ?, updatedAt = ? WHERE id = ?'
  ).run(updated.name, updated.host, updated.port, updated.username, updated.privateKeyPath, updated.sourceType, updated.agentId, updated.updatedAt, id);
  return updated;
}
```

- [ ] **Step 3: Run tests to verify all pass**

Run: `cd packages/core && pnpm test`
Expected: All tests PASS (including new sourceType/agentId tests)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/db/servers.ts
git commit -m "feat(core): update servers CRUD for sourceType and agentId fields"
```

---

### Task 5: NodeDataSource interface

**Files:**
- Create: `packages/core/src/datasource/types.ts`
- Create: `packages/core/src/datasource/index.ts`

- [ ] **Step 1: Create the NodeDataSource interface**

Create `packages/core/src/datasource/types.ts`:
```typescript
import type { MetricsSnapshot, ConnectionStatus } from '../types.js';

export interface NodeDataSource {
  readonly type: 'ssh' | 'agent';
  readonly serverId: string;

  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  getConnectionStatus(): ConnectionStatus;

  /**
   * Collect metrics from this node.
   * For SSH: executes remote commands.
   * For Agent: returns the latest pushed snapshot (or null if none).
   */
  collectMetrics(): Promise<MetricsSnapshot | null>;
}
```

- [ ] **Step 2: Create the barrel export**

Create `packages/core/src/datasource/index.ts`:
```typescript
export type { NodeDataSource } from './types.js';
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/datasource/
git commit -m "feat(core): define NodeDataSource interface"
```

---

### Task 6: SSHDataSource implementation

**Files:**
- Create: `packages/core/src/datasource/ssh-datasource.ts`
- Create: `packages/core/tests/datasource/ssh-datasource.test.ts`
- Modify: `packages/core/src/datasource/index.ts`

- [ ] **Step 1: Write test for SSHDataSource interface conformance**

Create `packages/core/tests/datasource/ssh-datasource.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SSHDataSource } from '../../src/datasource/ssh-datasource.js';
import type { ServerConfig } from '../../src/types.js';

const mockServer: ServerConfig = {
  id: 'srv-1',
  name: 'test',
  host: '192.168.1.1',
  port: 22,
  username: 'root',
  privateKeyPath: '/tmp/key',
  sourceType: 'ssh',
  agentId: null,
  createdAt: 0,
  updatedAt: 0,
};

describe('SSHDataSource', () => {
  it('should have type ssh', () => {
    const ds = new SSHDataSource(mockServer);
    expect(ds.type).toBe('ssh');
    expect(ds.serverId).toBe('srv-1');
  });

  it('should start disconnected', () => {
    const ds = new SSHDataSource(mockServer);
    expect(ds.isConnected()).toBe(false);
    expect(ds.getConnectionStatus()).toBe('disconnected');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm test`
Expected: FAIL — SSHDataSource module not found

- [ ] **Step 3: Implement SSHDataSource**

Create `packages/core/src/datasource/ssh-datasource.ts`:
```typescript
import fs from 'fs';
import os from 'os';
import { SSHManager } from '../ssh/manager.js';
import * as collectors from '../ssh/collectors/index.js';
import type { ServerConfig, MetricsSnapshot, ConnectionStatus } from '../types.js';
import type { NodeDataSource } from './types.js';

export class SSHDataSource implements NodeDataSource {
  readonly type = 'ssh' as const;
  readonly serverId: string;

  private server: ServerConfig;
  private ssh: SSHManager;
  private status: ConnectionStatus = 'disconnected';

  constructor(server: ServerConfig, ssh?: SSHManager) {
    this.server = server;
    this.serverId = server.id;
    this.ssh = ssh ?? new SSHManager();
  }

  async connect(): Promise<void> {
    if (this.ssh.isConnected(this.serverId)) {
      this.status = 'connected';
      return;
    }
    this.status = 'connecting';
    try {
      const keyPath = this.server.privateKeyPath.replace(/^~/, os.homedir());
      const keyBuffer = fs.readFileSync(keyPath);
      await this.ssh.connect(this.server, keyBuffer);
      this.status = 'connected';
    } catch (err) {
      this.status = 'error';
      throw err;
    }
  }

  disconnect(): void {
    this.ssh.disconnect(this.serverId);
    this.status = 'disconnected';
  }

  isConnected(): boolean {
    return this.ssh.isConnected(this.serverId);
  }

  getConnectionStatus(): ConnectionStatus {
    return this.status;
  }

  async collectMetrics(): Promise<MetricsSnapshot | null> {
    if (!this.isConnected()) {
      await this.connect();
    }

    const [cpu, memory, disk, network, gpu, processes, docker, system] = await Promise.all([
      collectors.collectCpu(this.ssh, this.serverId),
      collectors.collectMemory(this.ssh, this.serverId),
      collectors.collectDisk(this.ssh, this.serverId),
      collectors.collectNetwork(this.ssh, this.serverId),
      collectors.collectGpu(this.ssh, this.serverId),
      collectors.collectProcesses(this.ssh, this.serverId),
      collectors.collectDocker(this.ssh, this.serverId),
      collectors.collectSystem(this.ssh, this.serverId),
    ]);

    return {
      serverId: this.serverId,
      timestamp: Date.now(),
      cpu, memory, disk, network, gpu, processes, docker, system,
    };
  }

  getSSHManager(): SSHManager {
    return this.ssh;
  }

  updateServer(server: ServerConfig): void {
    this.server = server;
  }
}
```

- [ ] **Step 4: Update barrel export**

In `packages/core/src/datasource/index.ts`:
```typescript
export type { NodeDataSource } from './types.js';
export { SSHDataSource } from './ssh-datasource.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/core && pnpm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/datasource/ packages/core/tests/datasource/
git commit -m "feat(core): implement SSHDataSource wrapping existing SSH logic"
```

---

### Task 7: AgentDataSource stub

**Files:**
- Create: `packages/core/src/datasource/agent-datasource.ts`
- Create: `packages/core/tests/datasource/agent-datasource.test.ts`
- Modify: `packages/core/src/datasource/index.ts`

- [ ] **Step 1: Write test for AgentDataSource stub**

Create `packages/core/tests/datasource/agent-datasource.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { AgentDataSource } from '../../src/datasource/agent-datasource.js';

describe('AgentDataSource', () => {
  it('should have type agent', () => {
    const ds = new AgentDataSource('srv-1');
    expect(ds.type).toBe('agent');
    expect(ds.serverId).toBe('srv-1');
  });

  it('should start disconnected', () => {
    const ds = new AgentDataSource('srv-1');
    expect(ds.isConnected()).toBe(false);
    expect(ds.getConnectionStatus()).toBe('disconnected');
  });

  it('should return null from collectMetrics when no data pushed', async () => {
    const ds = new AgentDataSource('srv-1');
    const result = await ds.collectMetrics();
    expect(result).toBeNull();
  });

  it('should return pushed snapshot from collectMetrics', async () => {
    const ds = new AgentDataSource('srv-1');
    const fakeSnapshot = { serverId: 'srv-1', timestamp: 123 } as any;
    ds.pushMetrics(fakeSnapshot);
    const result = await ds.collectMetrics();
    expect(result).toEqual(fakeSnapshot);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm test`
Expected: FAIL — AgentDataSource module not found

- [ ] **Step 3: Implement AgentDataSource stub**

Create `packages/core/src/datasource/agent-datasource.ts`:
```typescript
import { EventEmitter } from 'events';
import type { MetricsSnapshot, ConnectionStatus } from '../types.js';
import type { NodeDataSource } from './types.js';

/**
 * AgentDataSource receives metrics pushed by a remote Python Agent via WebSocket.
 * This is a stub — full Agent WebSocket handling is in Plan 3.
 */
export class AgentDataSource extends EventEmitter implements NodeDataSource {
  readonly type = 'agent' as const;
  readonly serverId: string;

  private connected = false;
  private latestSnapshot: MetricsSnapshot | null = null;

  constructor(serverId: string) {
    super();
    this.serverId = serverId;
  }

  async connect(): Promise<void> {
    // Agent connects to us; this is a no-op.
    // Connection state is updated when Agent registers.
  }

  disconnect(): void {
    this.connected = false;
    this.latestSnapshot = null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getConnectionStatus(): ConnectionStatus {
    return this.connected ? 'connected' : 'disconnected';
  }

  async collectMetrics(): Promise<MetricsSnapshot | null> {
    // Agent mode: return the latest pushed snapshot (passive, no pull).
    return this.latestSnapshot;
  }

  /** Called when Agent pushes a metrics snapshot via WebSocket. */
  pushMetrics(snapshot: MetricsSnapshot): void {
    this.latestSnapshot = snapshot;
    this.connected = true;
    this.emit('metricsReceived', snapshot);
  }

  /** Called when Agent registers or reconnects. */
  setConnected(connected: boolean): void {
    this.connected = connected;
    if (!connected) {
      this.latestSnapshot = null;
    }
  }
}
```

- [ ] **Step 4: Update barrel export**

In `packages/core/src/datasource/index.ts`:
```typescript
export type { NodeDataSource } from './types.js';
export { SSHDataSource } from './ssh-datasource.js';
export { AgentDataSource } from './agent-datasource.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/core && pnpm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/datasource/ packages/core/tests/datasource/
git commit -m "feat(core): add AgentDataSource stub with push-based metrics"
```

---

### Task 8: DataSourceFactory

**Files:**
- Create: `packages/core/src/datasource/factory.ts`
- Create: `packages/core/tests/datasource/factory.test.ts`
- Modify: `packages/core/src/datasource/index.ts`

- [ ] **Step 1: Write test for DataSourceFactory**

Create `packages/core/tests/datasource/factory.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createDataSource } from '../../src/datasource/factory.js';
import { SSHDataSource } from '../../src/datasource/ssh-datasource.js';
import { AgentDataSource } from '../../src/datasource/agent-datasource.js';
import type { ServerConfig } from '../../src/types.js';

const baseServer: ServerConfig = {
  id: 'srv-1',
  name: 'test',
  host: '192.168.1.1',
  port: 22,
  username: 'root',
  privateKeyPath: '/tmp/key',
  sourceType: 'ssh',
  agentId: null,
  createdAt: 0,
  updatedAt: 0,
};

describe('createDataSource', () => {
  it('should create SSHDataSource for ssh sourceType', () => {
    const ds = createDataSource(baseServer);
    expect(ds).toBeInstanceOf(SSHDataSource);
    expect(ds.type).toBe('ssh');
  });

  it('should create AgentDataSource for agent sourceType', () => {
    const ds = createDataSource({ ...baseServer, sourceType: 'agent', agentId: 'a-1' });
    expect(ds).toBeInstanceOf(AgentDataSource);
    expect(ds.type).toBe('agent');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm test`
Expected: FAIL — factory module not found

- [ ] **Step 3: Implement DataSourceFactory**

Create `packages/core/src/datasource/factory.ts`:
```typescript
import type { ServerConfig } from '../types.js';
import type { NodeDataSource } from './types.js';
import { SSHDataSource } from './ssh-datasource.js';
import { AgentDataSource } from './agent-datasource.js';
import { SSHManager } from '../ssh/manager.js';

export function createDataSource(server: ServerConfig, sharedSSH?: SSHManager): NodeDataSource {
  switch (server.sourceType) {
    case 'agent':
      return new AgentDataSource(server.id);
    case 'ssh':
    default:
      return new SSHDataSource(server, sharedSSH);
  }
}
```

- [ ] **Step 4: Update barrel export**

In `packages/core/src/datasource/index.ts`:
```typescript
export type { NodeDataSource } from './types.js';
export { SSHDataSource } from './ssh-datasource.js';
export { AgentDataSource } from './agent-datasource.js';
export { createDataSource } from './factory.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/core && pnpm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/datasource/ packages/core/tests/datasource/
git commit -m "feat(core): add DataSourceFactory for creating SSH/Agent datasources"
```

---

### Task 9: Refactor Scheduler to use NodeDataSource

**Files:**
- Modify: `packages/core/src/scheduler.ts`
- Create: `packages/core/tests/scheduler.test.ts`

This is the core refactoring. The Scheduler should:
- Manage a map of `NodeDataSource` per server (instead of using SSH directly)
- For SSH nodes: active polling unchanged
- For Agent nodes: listen for push events (no polling)
- Expose `getDataSource(serverId)` for web handlers that need it

- [ ] **Step 1: Write test for new Scheduler behavior**

Create `packages/core/tests/scheduler.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDatabase } from '../src/db/database.js';
import { createServer } from '../src/db/servers.js';
import { Scheduler } from '../src/scheduler.js';
import type { ServerInput, MetricsSnapshot } from '../src/types.js';
import { AgentDataSource } from '../src/datasource/agent-datasource.js';

beforeEach(() => {
  getDatabase();
});

describe('Scheduler', () => {
  it('should expose getDataSource for a created server', () => {
    const server = createServer({
      name: 'test', host: '1.2.3.4', port: 22,
      username: 'root', privateKeyPath: '/tmp/key',
    });
    const scheduler = new Scheduler();
    scheduler.initDataSources();
    const ds = scheduler.getDataSource(server.id);
    expect(ds).toBeDefined();
    expect(ds!.type).toBe('ssh');
  });

  it('should handle Agent node metricsReceived event', async () => {
    const server = createServer({
      name: 'agent-node', host: 'gpu-01', port: 22,
      username: 'root', privateKeyPath: '/tmp/key',
      sourceType: 'agent', agentId: 'a1',
    });

    const scheduler = new Scheduler();
    scheduler.initDataSources();

    const ds = scheduler.getDataSource(server.id);
    expect(ds).toBeDefined();
    expect(ds!.type).toBe('agent');

    // Simulate Agent pushing metrics
    const received: MetricsSnapshot[] = [];
    scheduler.on('metricsUpdate', (snap: MetricsSnapshot) => {
      received.push(snap);
    });

    const fakeSnapshot = {
      serverId: server.id,
      timestamp: Date.now(),
      cpu: {} as any,
      memory: {} as any,
      disk: {} as any,
      network: {} as any,
      gpu: {} as any,
      processes: [],
      docker: [],
      system: {} as any,
    } satisfies MetricsSnapshot;

    (ds as AgentDataSource).pushMetrics(fakeSnapshot);

    // Give event loop a tick
    await new Promise(r => setTimeout(r, 10));

    expect(received.length).toBe(1);
    expect(received[0].serverId).toBe(server.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm test`
Expected: FAIL — `scheduler.initDataSources` and `scheduler.getDataSource` don't exist

- [ ] **Step 3: Rewrite the Scheduler**

Replace the entire `packages/core/src/scheduler.ts`:

```typescript
import { EventEmitter } from 'events';
import { getAllServers, getServerById } from './db/servers.js';
import { saveMetrics, cleanOldMetrics } from './db/metrics.js';
import { getSettings } from './db/settings.js';
import { checkAlerts } from './alerts.js';
import { evaluateHooks } from './hooks/engine.js';
import { createDataSource } from './datasource/factory.js';
import { SSHManager } from './ssh/manager.js';
import { SSHDataSource } from './datasource/ssh-datasource.js';
import { AgentDataSource } from './datasource/agent-datasource.js';
import type { NodeDataSource } from './datasource/types.js';
import type { MetricsSnapshot, ServerStatus, ConnectionStatus } from './types.js';

export class Scheduler extends EventEmitter {
  private sharedSSH = new SSHManager();
  private dataSources = new Map<string, NodeDataSource>();
  private timerId: ReturnType<typeof setInterval> | null = null;
  private cleanupTimerId: ReturnType<typeof setInterval> | null = null;
  private serverStatuses = new Map<string, ServerStatus>();

  getSSHManager(): SSHManager {
    return this.sharedSSH;
  }

  getDataSource(serverId: string): NodeDataSource | undefined {
    return this.dataSources.get(serverId);
  }

  getServerStatus(serverId: string): ServerStatus | undefined {
    return this.serverStatuses.get(serverId);
  }

  getAllStatuses(): ServerStatus[] {
    return Array.from(this.serverStatuses.values());
  }

  /** Initialize or refresh data sources for all configured servers. */
  initDataSources(): void {
    const servers = getAllServers();
    const currentIds = new Set(servers.map(s => s.id));

    // Remove stale datasources
    for (const [id, ds] of this.dataSources) {
      if (!currentIds.has(id)) {
        ds.disconnect();
        this.dataSources.delete(id);
      }
    }

    // Create or update datasources
    for (const server of servers) {
      const existing = this.dataSources.get(server.id);

      if (existing && existing.type === server.sourceType) {
        // Same type, update config if SSH
        if (existing instanceof SSHDataSource) {
          existing.updateServer(server);
        }
        continue;
      }

      // Type changed or new server — create fresh
      if (existing) {
        existing.disconnect();
      }

      const ds = createDataSource(server, this.sharedSSH);
      this.dataSources.set(server.id, ds);

      // For Agent datasources, listen for pushed metrics
      if (ds instanceof AgentDataSource) {
        ds.on('metricsReceived', (snapshot: MetricsSnapshot) => {
          this.handleMetrics(snapshot, server.id);
        });
      }
    }
  }

  start(): void {
    if (this.timerId) return;

    this.initDataSources();

    const settings = getSettings();
    this.timerId = setInterval(() => {
      this.collectAllSSH();
    }, settings.refreshIntervalMs);

    // Run immediately
    this.collectAllSSH();

    // Cleanup old metrics every hour
    this.cleanupTimerId = setInterval(() => {
      const s = getSettings();
      cleanOldMetrics(s.historyRetentionDays);
    }, 60 * 60 * 1000);
  }

  stop(): void {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.cleanupTimerId) {
      clearInterval(this.cleanupTimerId);
      this.cleanupTimerId = null;
    }
    for (const ds of this.dataSources.values()) {
      ds.disconnect();
    }
    this.dataSources.clear();
    this.sharedSSH.disconnectAll();
  }

  restart(): void {
    this.stop();
    this.start();
  }

  /** Only poll SSH data sources. Agent sources push data themselves. */
  private async collectAllSSH(): Promise<void> {
    const sshSources = Array.from(this.dataSources.values())
      .filter((ds): ds is SSHDataSource => ds.type === 'ssh');

    const promises = sshSources.map(ds => this.collectFromSource(ds));
    await Promise.allSettled(promises);
  }

  /** Collect from a single data source (used for SSH polling and on-demand). */
  async collectServer(serverId: string): Promise<MetricsSnapshot | null> {
    const ds = this.dataSources.get(serverId);
    if (!ds) {
      // Maybe server was just created — re-init
      this.initDataSources();
      const refreshed = this.dataSources.get(serverId);
      if (!refreshed) return null;
      return this.collectFromSource(refreshed);
    }
    return this.collectFromSource(ds);
  }

  private async collectFromSource(ds: NodeDataSource): Promise<MetricsSnapshot | null> {
    const updateStatus = (status: ConnectionStatus, error?: string) => {
      const s: ServerStatus = {
        serverId: ds.serverId,
        status,
        lastSeen: Date.now(),
        error,
      };
      this.serverStatuses.set(ds.serverId, s);
      this.emit('serverStatus', s);
    };

    try {
      if (!ds.isConnected()) {
        updateStatus('connecting');
        await ds.connect();
      }
      updateStatus('connected');

      const snapshot = await ds.collectMetrics();
      if (!snapshot) return null;

      this.handleMetrics(snapshot, ds.serverId);
      return snapshot;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      updateStatus('error', errMsg);
      ds.disconnect();
      return null;
    }
  }

  /** Shared post-collection pipeline: save, alert, hook, broadcast. */
  private handleMetrics(snapshot: MetricsSnapshot, serverId: string): void {
    // Save to DB
    saveMetrics(snapshot);

    // Update status with latest metrics
    const status = this.serverStatuses.get(serverId);
    if (status) {
      status.latestMetrics = snapshot;
      status.lastSeen = Date.now();
      status.status = 'connected';
    } else {
      this.serverStatuses.set(serverId, {
        serverId,
        status: 'connected',
        lastSeen: Date.now(),
        latestMetrics: snapshot,
      });
    }
    this.emit('serverStatus', this.serverStatuses.get(serverId));

    // Emit to listeners (web UI via Socket.IO)
    this.emit('metricsUpdate', snapshot);

    // Check alerts
    const settings = getSettings();
    const server = getServerById(serverId);
    if (server) {
      checkAlerts(snapshot, settings, server);
    }

    // Evaluate hooks
    evaluateHooks(snapshot).catch(() => {});
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && pnpm test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/scheduler.ts packages/core/tests/scheduler.test.ts
git commit -m "refactor(core): rewrite Scheduler to use NodeDataSource abstraction"
```

---

### Task 10: Update core exports

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add datasource exports to index.ts**

Add the following lines to `packages/core/src/index.ts`:
```typescript
export type { NodeDataSource } from './datasource/types.js';
export { SSHDataSource } from './datasource/ssh-datasource.js';
export { AgentDataSource } from './datasource/agent-datasource.js';
export { createDataSource } from './datasource/factory.js';
```

- [ ] **Step 2: Run tests to verify nothing broke**

Run: `cd packages/core && pnpm test`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): export datasource types and implementations"
```

---

### Task 11: Update web server for new architecture

**Files:**
- Modify: `packages/web/src/handlers.ts`
- Modify: `packages/web/src/server.ts`

- [ ] **Step 1: Update handlers.ts — server delete should use DataSource disconnect**

In `packages/web/src/handlers.ts`, update the `DELETE /api/servers/:id` handler. Replace:

```typescript
  app.delete('/api/servers/:id', (req: any, res: any) => {
    deleteServer(req.params.id);
    scheduler.getSSHManager().disconnect(req.params.id);
    res.json({ ok: true });
  });
```

With:

```typescript
  app.delete('/api/servers/:id', (req: any, res: any) => {
    const ds = scheduler.getDataSource(req.params.id);
    if (ds) ds.disconnect();
    deleteServer(req.params.id);
    scheduler.initDataSources();
    res.json({ ok: true });
  });
```

- [ ] **Step 2: Update handlers.ts — server create/update should refresh datasources**

After the `POST /api/servers` handler's `res.json(server)` line, add:
```typescript
    scheduler.initDataSources();
```

After the `PUT /api/servers/:id` handler's `res.json(server)` line, add:
```typescript
    scheduler.initDataSources();
```

- [ ] **Step 3: Update handlers.ts — test connection endpoint for unsaved servers**

The test connection endpoint already uses a standalone SSHManager, which is fine. No changes needed.

- [ ] **Step 4: Update the import in handlers.ts**

In the imports at the top of `packages/web/src/handlers.ts`, the existing import:

```typescript
import {
  getAllServers, getServerById, createServer, updateServer, deleteServer,
  getLatestMetrics, getMetricsHistory,
  getAllHooks, createHook, updateHook, deleteHook, getHookLogs,
  getSettings, saveSettings,
  setAlertCallback, setHookTriggeredCallback, setNotifyCallback,
  SSHManager,
  getAlerts, suppressAlert,
} from '@monitor/core';
```

Keep it as-is. The `SSHManager` import is still used for the `/api/servers/test` endpoint (testing unsaved servers).

- [ ] **Step 5: Verify web server compiles**

Run: `cd packages/web && pnpm exec tsc --noEmit`
Expected: No errors (or if there's no tsconfig configured for noEmit, use `npx tsc --noEmit`)

If TypeScript config doesn't exist for noEmit check, just verify no syntax errors in the changes.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/handlers.ts packages/web/src/server.ts
git commit -m "refactor(web): update handlers to use DataSource abstraction"
```

---

### Task 12: Remove Electron package

**Files:**
- Delete: `packages/electron/` (entire directory)
- Modify: `packages/ui/src/transport/TransportProvider.tsx`
- Delete: `packages/ui/src/transport/ipc-adapter.ts`
- Modify: `package.json` (root)
- Modify: `pnpm-workspace.yaml`

- [ ] **Step 1: Delete Electron package directory**

Run:
```bash
rm -rf packages/electron
```

- [ ] **Step 2: Delete IPC adapter**

Run:
```bash
rm packages/ui/src/transport/ipc-adapter.ts
```

- [ ] **Step 3: Simplify TransportProvider**

Replace `packages/ui/src/transport/TransportProvider.tsx` with:

```typescript
import React, { createContext, useContext, useEffect, useState } from 'react';
import type { TransportAdapter } from './types.js';
import { WebSocketAdapter } from './ws-adapter.js';

const TransportContext = createContext<TransportAdapter | null>(null);

export function TransportProvider({ children }: { children: React.ReactNode }) {
  const [transport] = useState<TransportAdapter>(() => new WebSocketAdapter());

  useEffect(() => {
    transport.connect();
    return () => transport.disconnect();
  }, [transport]);

  return (
    <TransportContext.Provider value={transport}>
      {children}
    </TransportContext.Provider>
  );
}

export function useTransport(): TransportAdapter {
  const ctx = useContext(TransportContext);
  if (!ctx) throw new Error('useTransport must be used within TransportProvider');
  return ctx;
}
```

- [ ] **Step 4: Remove `isElectron` from TransportAdapter interface**

In `packages/ui/src/transport/types.ts`, remove the line:
```typescript
  readonly isElectron: boolean;
```

- [ ] **Step 5: Remove isElectron from ws-adapter.ts**

In `packages/ui/src/transport/ws-adapter.ts`, remove the line:
```typescript
  readonly isElectron = false;
```

- [ ] **Step 6: Remove Electron scripts from root package.json**

In the root `package.json`, remove these scripts:
```json
"dev:electron": "pnpm --filter @monitor/electron dev",
"build:electron": "pnpm run build:core && pnpm --filter @monitor/electron build",
```

- [ ] **Step 7: Remove electron from pnpm-workspace.yaml onlyBuiltDependencies**

In `pnpm-workspace.yaml`, remove the `- electron` line from `onlyBuiltDependencies`.

- [ ] **Step 8: Update root package.json description**

Change description from:
```
"Multi-server hardware monitor for labs - Electron & Web dual mode"
```
To:
```
"PMEOW - GPU cluster monitoring and scheduling platform for labs"
```

- [ ] **Step 9: Run pnpm install to clean lockfile**

Run: `pnpm install`

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: remove Electron package, simplify transport to WebSocket only"
```

---

### Task 13: End-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Run all core tests**

Run: `cd packages/core && pnpm test`
Expected: All tests PASS

- [ ] **Step 2: Verify TypeScript compilation of core**

Run: `cd packages/core && pnpm exec tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify web package compiles**

Run: `cd packages/web && pnpm exec tsc --noEmit`
Expected: No errors (or only pre-existing issues unrelated to our changes)

- [ ] **Step 4: Verify UI package builds**

Run: `pnpm run build:ui`
Expected: Build succeeds

- [ ] **Step 5: Quick manual smoke test**

If a dev environment is available:
```bash
pnpm dev:web &
pnpm dev:ui
```
Verify the web UI loads and pages render without errors. No servers need to be configured — just verify the app starts.

- [ ] **Step 6: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address issues found during verification"
```

- [ ] **Step 7: Tag milestone**

```bash
git tag v2-plan1-foundation
```
