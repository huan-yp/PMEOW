import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabase } from '../../src/db/database.js';
import { getSettings, saveSettings } from '../../src/db/settings.js';
import {
  DEFAULT_SETTINGS,
  type GpuOverviewResponse,
  type GpuOverviewServerSummary,
  type GpuOverviewUserSummary,
  type GpuUsageSummaryItem,
  type GpuUsageTimelinePoint,
  type ProcessAuditRow,
  type SecurityEventDetails,
  type SecurityEventRecord,
} from '../../src/types.js';

const dtoContracts = {
  securityEventDetails: {
    reason: 'gpu_usage_without_task',
    pid: 42,
    user: 'alice',
    command: 'python train.py',
    gpuIndex: 0,
    taskId: null,
    keyword: 'xmrig',
    targetEventId: 99,
    durationMinutes: 30,
    usedMemoryMB: 2048,
  } satisfies SecurityEventDetails,
  securityEventRecord: {
    id: 7,
    serverId: 'server-1',
    eventType: 'unowned_gpu',
    fingerprint: 'server-1:0:42',
    details: {
      reason: 'gpu_usage_without_task',
    },
    resolved: false,
    resolvedBy: null,
    createdAt: 1_700_000_000_000,
    resolvedAt: null,
  } satisfies SecurityEventRecord,
  processAuditRow: {
    pid: 4242,
    user: 'alice',
    command: 'python train.py',
    cpuPercent: 12.5,
    memPercent: 7.5,
    rss: 524288,
    gpuMemoryMB: 4096,
    ownerType: 'task',
    taskId: null,
    suspiciousReasons: ['mining_keyword'],
  } satisfies ProcessAuditRow,
  gpuOverviewUserSummary: {
    user: 'alice',
    totalVramMB: 8192,
    taskCount: 2,
    processCount: 3,
    serverIds: ['server-1', 'server-2'],
  } satisfies GpuOverviewUserSummary,
  gpuOverviewServerSummary: {
    serverId: 'server-1',
    serverName: 'Training Host',
    totalUsedMB: 12288,
    totalTaskMB: 8192,
    totalNonTaskMB: 4096,
  } satisfies GpuOverviewServerSummary,
  gpuOverviewResponse: {
    generatedAt: 1_700_000_000_000,
    users: [
      {
        user: 'alice',
        totalVramMB: 8192,
        taskCount: 2,
        processCount: 3,
        serverIds: ['server-1'],
      },
    ],
    servers: [
      {
        serverId: 'server-1',
        serverName: 'Training Host',
        totalUsedMB: 12288,
        totalTaskMB: 8192,
        totalNonTaskMB: 4096,
      },
    ],
  } satisfies GpuOverviewResponse,
  gpuUsageSummaryItem: {
    user: 'alice',
    totalVramMB: 8192,
    taskVramMB: 6144,
    nonTaskVramMB: 2048,
  } satisfies GpuUsageSummaryItem,
  gpuUsageTimelinePoint: {
    bucketStart: 1_700_000_000_000,
    user: 'alice',
    totalVramMB: 8192,
    taskVramMB: 6144,
    nonTaskVramMB: 2048,
  } satisfies GpuUsageTimelinePoint,
};

void dtoContracts;

beforeEach(() => {
  getDatabase();
});

describe('settings repository', () => {
  it('returns default flat security settings when none are persisted', () => {
    const settings = getSettings();

    expect(DEFAULT_SETTINGS.securityUnownedGpuMinutes).toBe(30);
    expect(settings.securityUnownedGpuMinutes).toBe(30);

    expect(settings).toHaveProperty('securityMiningKeywords', DEFAULT_SETTINGS.securityMiningKeywords);
    expect(settings).toHaveProperty('securityUnownedGpuMinutes', DEFAULT_SETTINGS.securityUnownedGpuMinutes);
    expect(settings).toHaveProperty(
      'securityHighGpuUtilizationPercent',
      DEFAULT_SETTINGS.securityHighGpuUtilizationPercent,
    );
    expect(settings).toHaveProperty(
      'securityHighGpuDurationMinutes',
      DEFAULT_SETTINGS.securityHighGpuDurationMinutes,
    );
  });

  it('persists and reloads flat security settings', () => {
    saveSettings({
      securityMiningKeywords: ['xmrig', 'ethminer', 'nbminer'],
      securityUnownedGpuMinutes: 15,
      securityHighGpuUtilizationPercent: 95,
      securityHighGpuDurationMinutes: 90,
    });

    const db = getDatabase();
    const rows = db.prepare(
      `SELECT key, value FROM settings
       WHERE key IN (
         'securityMiningKeywords',
         'securityUnownedGpuMinutes',
         'securityHighGpuUtilizationPercent',
         'securityHighGpuDurationMinutes'
       )
       ORDER BY key ASC`
    ).all() as { key: string; value: string }[];

    expect(rows).toEqual([
      { key: 'securityHighGpuDurationMinutes', value: '90' },
      { key: 'securityHighGpuUtilizationPercent', value: '95' },
      { key: 'securityMiningKeywords', value: '["xmrig","ethminer","nbminer"]' },
      { key: 'securityUnownedGpuMinutes', value: '15' },
    ]);

    expect(getSettings()).toMatchObject({
      securityMiningKeywords: ['xmrig', 'ethminer', 'nbminer'],
      securityUnownedGpuMinutes: 15,
      securityHighGpuUtilizationPercent: 95,
      securityHighGpuDurationMinutes: 90,
    });
  });

  it('persists and reloads zero values for flat security numeric settings', () => {
    saveSettings({
      securityUnownedGpuMinutes: 0,
      securityHighGpuUtilizationPercent: 0,
      securityHighGpuDurationMinutes: 0,
    });

    const db = getDatabase();
    const rows = db.prepare(
      `SELECT key, value FROM settings
       WHERE key IN (
         'securityUnownedGpuMinutes',
         'securityHighGpuUtilizationPercent',
         'securityHighGpuDurationMinutes'
       )
       ORDER BY key ASC`
    ).all() as { key: string; value: string }[];

    expect(rows).toEqual([
      { key: 'securityHighGpuDurationMinutes', value: '0' },
      { key: 'securityHighGpuUtilizationPercent', value: '0' },
      { key: 'securityUnownedGpuMinutes', value: '0' },
    ]);

    expect(getSettings()).toMatchObject({
      securityUnownedGpuMinutes: 0,
      securityHighGpuUtilizationPercent: 0,
      securityHighGpuDurationMinutes: 0,
    });
  });
});