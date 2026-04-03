import { describe, expect, it, vi } from 'vitest';
import { getDatabase } from '../../src/db/database.js';
import {
  createSecurityEvent,
  findOpenSecurityEvent,
  listSecurityEvents,
  markSecurityEventSafe,
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
        resolved: false,
        resolvedBy: null,
        createdAt: 3_000,
        resolvedAt: null,
      },
    });

    expect(findOpenSecurityEvent('server-a', 'suspicious_process', 'fp-1')).toBeUndefined();
    expect(listSecurityEvents({ serverId: 'server-a', resolved: false })).toEqual([
      result!.auditEvent,
    ]);
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
        resolved: false,
        resolvedBy: null,
        createdAt: 30_000,
        resolvedAt: null,
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