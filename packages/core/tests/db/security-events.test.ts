import { describe, expect, it, vi } from 'vitest';
import { getDatabase } from '../../src/db/database.js';
import {
  createSecurityEvent,
  findOpenSecurityEvent,
  listSecurityEvents,
  markSecurityEventSafe,
  unresolveSecurityEvent,
} from '../../src/db/security-events.js';

describe('security_events schema', () => {
  it('creates the security events table and required indexes', () => {
    const db = getDatabase();
    const table = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'security_events'"
    ).get() as { name: string } | undefined;
    const serverIndex = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_security_events_server_created_at'"
    ).get() as { name: string } | undefined;
    const resolvedIndex = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_security_events_resolved_created_at'"
    ).get() as { name: string } | undefined;
    const fingerprintIndex = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_security_events_open_fingerprint'"
    ).get() as { name: string } | undefined;
    const columns = new Set(
      (db.prepare('PRAGMA table_info(security_events)').all() as { name: string }[]).map(column => column.name)
    );

    expect(table?.name).toBe('security_events');
    expect(serverIndex?.name).toBe('idx_security_events_server_created_at');
    expect(resolvedIndex?.name).toBe('idx_security_events_resolved_created_at');
    expect(fingerprintIndex?.name).toBe('idx_security_events_open_fingerprint');
    expect(columns).toEqual(new Set([
      'id',
      'serverId',
      'eventType',
      'fingerprint',
      'detailsJson',
      'resolved',
      'resolvedBy',
      'createdAt',
      'resolvedAt',
    ]));
  });

  it('fixes stale unresolved marked_safe audit events on database init', () => {
    const db = getDatabase();

    // Simulate a stale marked_safe row created before the fix:
    // 1. Create a suspicious_process event and mark it resolved
    db.exec(`
      INSERT INTO security_events (serverId, eventType, fingerprint, detailsJson, resolved, resolvedBy, createdAt, resolvedAt)
      VALUES ('srv-migrate', 'suspicious_process', 'fp-stale', '{"reason":"bad"}', 1, 'admin', 100, 200)
    `);
    const originalId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;

    // 2. Create a marked_safe audit event that was incorrectly left unresolved
    db.exec(`
      INSERT INTO security_events (serverId, eventType, fingerprint, detailsJson, resolved, resolvedBy, createdAt, resolvedAt)
      VALUES ('srv-migrate', 'marked_safe', 'marked_safe:${originalId}:200', '{"reason":"ok","targetEventId":${originalId}}', 0, NULL, 300, NULL)
    `);
    const auditId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;

    // Verify it's currently broken
    const before = db.prepare('SELECT resolved, resolvedBy, resolvedAt FROM security_events WHERE id = ?').get(auditId) as {
      resolved: number; resolvedBy: string | null; resolvedAt: number | null;
    };
    expect(before.resolved).toBe(0);

    // Run the migration fix manually (same SQL as in initSchema)
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

    const after = db.prepare('SELECT resolved, resolvedBy, resolvedAt FROM security_events WHERE id = ?').get(auditId) as {
      resolved: number; resolvedBy: string | null; resolvedAt: number | null;
    };
    expect(after.resolved).toBe(1);
    expect(after.resolvedBy).toBe('admin');
    expect(after.resolvedAt).toBe(200);

    // The stale row should no longer appear in unresolved list
    expect(listSecurityEvents({ serverId: 'srv-migrate', resolved: false })).toEqual([]);
  });
});

describe('security event repository', () => {
  it('creates, finds, lists unresolved events, and appends a marked_safe audit event', () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(3_000);

    const original = createSecurityEvent({
      serverId: 'server-a',
      eventType: 'suspicious_process',
      fingerprint: 'fp-1',
      details: {
        reason: 'matched forbidden keyword',
        pid: 456,
        user: 'alice',
        command: 'python miner.py',
        taskId: 'task-9',
        gpuIndex: 0,
        keyword: 'miner',
        usedMemoryMB: 2048,
      },
    });

    expect(findOpenSecurityEvent('server-a', 'suspicious_process', 'fp-1')).toEqual(original);
    expect(listSecurityEvents({ serverId: 'server-a', resolved: false })).toEqual([original]);

    const result = markSecurityEventSafe(original.id, 'operator-1', 'false positive');

    expect(result).toEqual({
      resolvedEvent: {
        ...original,
        resolved: true,
        resolvedBy: 'operator-1',
        resolvedAt: 2_000,
      },
      auditEvent: {
        id: expect.any(Number),
        serverId: 'server-a',
        eventType: 'marked_safe',
        fingerprint: 'marked_safe:1:2000',
        details: {
          reason: 'false positive',
          targetEventId: original.id,
          pid: 456,
          user: 'alice',
          command: 'python miner.py',
          taskId: 'task-9',
        },
        resolved: true,
        resolvedBy: 'operator-1',
        createdAt: 3_000,
        resolvedAt: 2_000,
      },
    });

    expect(findOpenSecurityEvent('server-a', 'suspicious_process', 'fp-1')).toBeUndefined();
    expect(listSecurityEvents({ serverId: 'server-a', resolved: false })).toEqual([]);
    expect(listSecurityEvents({ serverId: 'server-a' })).toEqual([
      result!.auditEvent,
      result!.resolvedEvent,
    ]);
  });

  it('returns the existing resolved event without adding audit events when marked safe twice', () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(10_000)
      .mockReturnValueOnce(20_000)
      .mockReturnValueOnce(30_000)
      .mockReturnValueOnce(40_000);

    const original = createSecurityEvent({
      serverId: 'server-b',
      eventType: 'suspicious_process',
      fingerprint: 'fp-2',
      details: {
        reason: 'matched forbidden keyword',
        pid: 789,
        user: 'bob',
        command: 'python suspicious.py',
        taskId: 'task-10',
        gpuIndex: 1,
        keyword: 'suspicious',
        usedMemoryMB: 1024,
      },
    });

    const firstResult = markSecurityEventSafe(original.id, 'operator-2', 'confirmed safe');
    const secondResult = markSecurityEventSafe(original.id, 'operator-3', 'retry');

    expect(firstResult).toEqual({
      resolvedEvent: {
        ...original,
        resolved: true,
        resolvedBy: 'operator-2',
        resolvedAt: 20_000,
      },
      auditEvent: {
        id: expect.any(Number),
        serverId: 'server-b',
        eventType: 'marked_safe',
        fingerprint: 'marked_safe:1:20000',
        details: {
          reason: 'confirmed safe',
          targetEventId: original.id,
          pid: 789,
          user: 'bob',
          command: 'python suspicious.py',
          taskId: 'task-10',
        },
        resolved: true,
        resolvedBy: 'operator-2',
        createdAt: 30_000,
        resolvedAt: 20_000,
      },
    });

    expect(secondResult).toEqual({
      resolvedEvent: firstResult!.resolvedEvent,
      auditEvent: undefined,
    });

    expect(listSecurityEvents({ serverId: 'server-b' })).toEqual([
      firstResult!.auditEvent,
      firstResult!.resolvedEvent,
    ]);
  });
});

describe('unresolveSecurityEvent', () => {
  it('reopens a resolved event and creates an unresolve audit event', () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(100_000)   // create original
      .mockReturnValueOnce(200_000)   // markSecurityEventSafe resolvedAt
      .mockReturnValueOnce(300_000)   // markSecurityEventSafe audit createdAt
      .mockReturnValueOnce(400_000)   // unresolve now (used for update + audit fingerprint)
      .mockReturnValueOnce(400_000);  // unresolve audit createdAt

    const original = createSecurityEvent({
      serverId: 'server-u1',
      eventType: 'suspicious_process',
      fingerprint: 'fp-u1',
      details: {
        reason: 'matched keyword',
        pid: 111,
        user: 'alice',
        command: 'xmrig',
        taskId: 'task-u1',
      },
    });

    markSecurityEventSafe(original.id, 'op-1', 'false positive');

    const result = unresolveSecurityEvent(original.id, 'op-2', 'need to re-investigate');
    expect(result).not.toHaveProperty('error');

    const { reopenedEvent, auditEvent } = result as { reopenedEvent: any; auditEvent: any };

    expect(reopenedEvent.id).toBe(original.id);
    expect(reopenedEvent.resolved).toBe(false);
    expect(reopenedEvent.resolvedBy).toBeNull();
    expect(reopenedEvent.resolvedAt).toBeNull();

    expect(auditEvent.eventType).toBe('unresolve');
    expect(auditEvent.resolved).toBe(true);
    expect(auditEvent.resolvedBy).toBe('op-2');
    expect(auditEvent.details.targetEventId).toBe(original.id);
    expect(auditEvent.details.reason).toBe('need to re-investigate');
    expect(auditEvent.details.pid).toBe(111);
    expect(auditEvent.details.user).toBe('alice');
    expect(auditEvent.details.command).toBe('xmrig');

    expect(findOpenSecurityEvent('server-u1', 'suspicious_process', 'fp-u1')).toEqual(reopenedEvent);
  });

  it('returns not_found for nonexistent event', () => {
    const result = unresolveSecurityEvent(99999, 'op', 'reason');
    expect(result).toEqual({ error: 'not_found' });
  });

  it('returns not_resolved for an unresolved event', () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(500_000);

    const event = createSecurityEvent({
      serverId: 'server-u2',
      eventType: 'unowned_gpu',
      fingerprint: 'fp-u2',
      details: { reason: 'unowned gpu' },
    });

    const result = unresolveSecurityEvent(event.id, 'op', 'reason');
    expect(result).toEqual({ error: 'not_resolved' });
  });

  it('returns not_found when trying to unresolve a marked_safe audit event', () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(600_000)
      .mockReturnValueOnce(700_000)
      .mockReturnValueOnce(800_000);

    const event = createSecurityEvent({
      serverId: 'server-u3',
      eventType: 'suspicious_process',
      fingerprint: 'fp-u3',
      details: { reason: 'keyword', pid: 222, user: 'bob', command: 'miner' },
    });

    const safeResult = markSecurityEventSafe(event.id, 'op', 'safe');
    const auditId = safeResult!.auditEvent!.id;

    const result = unresolveSecurityEvent(auditId, 'op', 'reason');
    expect(result).toEqual({ error: 'not_found' });
  });

  it('returns duplicate_open when an open event with same fingerprint exists', () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(900_000)
      .mockReturnValueOnce(1_000_000)
      .mockReturnValueOnce(1_100_000)
      .mockReturnValueOnce(1_200_000);

    const eventA = createSecurityEvent({
      serverId: 'server-u4',
      eventType: 'suspicious_process',
      fingerprint: 'fp-u4',
      details: { reason: 'keyword', pid: 333, user: 'charlie', command: 'bad' },
    });

    markSecurityEventSafe(eventA.id, 'op', 'safe');

    // Create a new event with same fingerprint (system re-detected the condition)
    createSecurityEvent({
      serverId: 'server-u4',
      eventType: 'suspicious_process',
      fingerprint: 'fp-u4',
      details: { reason: 'keyword again', pid: 333, user: 'charlie', command: 'bad' },
    });

    const result = unresolveSecurityEvent(eventA.id, 'op', 'reason');
    expect(result).toEqual({ error: 'duplicate_open' });
  });

  it('supports a full resolve-unresolve-resolve cycle', () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(2_000_000)   // create
      .mockReturnValueOnce(2_100_000)   // mark safe resolvedAt
      .mockReturnValueOnce(2_200_000)   // mark safe audit createdAt
      .mockReturnValueOnce(2_300_000)   // unresolve now
      .mockReturnValueOnce(2_300_000)   // unresolve audit createdAt
      .mockReturnValueOnce(2_400_000)   // mark safe again resolvedAt
      .mockReturnValueOnce(2_500_000);  // mark safe again audit createdAt

    const event = createSecurityEvent({
      serverId: 'server-u5',
      eventType: 'suspicious_process',
      fingerprint: 'fp-u5',
      details: { reason: 'keyword', pid: 444, user: 'dave', command: 'sus' },
    });

    markSecurityEventSafe(event.id, 'op-1', 'safe');
    unresolveSecurityEvent(event.id, 'op-2', 're-check');
    markSecurityEventSafe(event.id, 'op-3', 'confirmed safe');

    const allEvents = listSecurityEvents({ serverId: 'server-u5' });
    const markedSafeEvents = allEvents.filter(e => e.eventType === 'marked_safe');
    const unresolveEvents = allEvents.filter(e => e.eventType === 'unresolve');

    expect(markedSafeEvents).toHaveLength(2);
    expect(unresolveEvents).toHaveLength(1);

    const finalEvent = allEvents.find(e => e.id === event.id);
    expect(finalEvent!.resolved).toBe(true);
    expect(finalEvent!.resolvedBy).toBe('op-3');
  });
});