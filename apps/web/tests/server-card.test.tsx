import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ServerCard } from '../src/components/ServerCard.js';
import type { Server, ServerStatus, UnifiedReport } from '../src/transport/types.js';

function createServer(): Server {
  return {
    id: 'server-a',
    name: 'GPU Node A',
    agentId: 'agent-a',
    createdAt: 0,
    updatedAt: 0,
  };
}

function createStatus(): ServerStatus {
  return {
    serverId: 'server-a',
    status: 'online',
    version: '1.1.0',
    lastSeenAt: Date.now(),
  };
}

function createReport(): UnifiedReport {
  return {
    agentId: 'agent-a',
    timestamp: 1_713_312_000,
    seq: 10,
    resourceSnapshot: {
      gpuCards: [],
      cpu: { usagePercent: 12, coreCount: 8, modelName: 'AMD EPYC', frequencyMhz: 2400, perCoreUsage: [] },
      memory: { totalMb: 65536, usedMb: 16384, availableMb: 49152, usagePercent: 25, swapTotalMb: 0, swapUsedMb: 0, swapPercent: 0 },
      disks: [
        { filesystem: '/dev/sda1', mountPoint: '/boot', totalGB: 100, usedGB: 10, availableGB: 90, usagePercent: 10 },
        { filesystem: '/dev/sda2', mountPoint: '/', totalGB: 900, usedGB: 540, availableGB: 360, usagePercent: 60 },
        { filesystem: '/dev/sdb1', mountPoint: '/data', totalGB: 1000, usedGB: 550, availableGB: 450, usagePercent: 55 },
      ],
      diskIo: { readBytesPerSec: 0, writeBytesPerSec: 0 },
      network: { rxBytesPerSec: 0, txBytesPerSec: 0, interfaces: [] },
      processes: [],
      processesByUser: [],
      localUsers: [],
    },
    taskQueue: { queued: [], running: [], recentlyEnded: [] },
  };
}

describe('ServerCard', () => {
  it('summarizes disk usage across all mounted disks in the node running view', () => {
    render(
      <MemoryRouter>
        <ServerCard server={createServer()} status={createStatus()} report={createReport()} />
      </MemoryRouter>,
    );

    expect(screen.getByText('磁盘')).toBeTruthy();
    expect(screen.getByText('55.0%')).toBeTruthy();
    expect(screen.getByText('3 个挂载点 · 1100.0/2000.0 GB')).toBeTruthy();
    expect(screen.getByText('已用 1100.0/2000.0 GB')).toBeTruthy();
  });
});
