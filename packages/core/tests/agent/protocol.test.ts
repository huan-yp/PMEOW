import { describe, expect, it } from 'vitest';
import {
  AGENT_EVENT,
  SERVER_COMMAND,
  isAgentLocalUsersPayload,
  isAgentMetricsEnvelope,
  isAgentRegisterPayload,
  isAgentTaskUpdatePayload,
  isServerCommandEnvelope,
} from '../../src/agent/protocol.js';
import type { MetricsSnapshot } from '../../src/types.js';

function createSnapshot(overrides: Partial<MetricsSnapshot> = {}): MetricsSnapshot {
  return {
    serverId: 'server-1',
    timestamp: 1712010000,
    cpu: {
      usagePercent: 42,
      coreCount: 16,
      modelName: 'Threadripper',
      frequencyMhz: 3600,
      perCoreUsage: [41, 43],
    },
    memory: {
      totalMB: 65536,
      usedMB: 32768,
      availableMB: 32768,
      usagePercent: 50,
      swapTotalMB: 8192,
      swapUsedMB: 0,
      swapPercent: 0,
    },
    disk: {
      disks: [],
      ioReadKBs: 0,
      ioWriteKBs: 0,
    },
    network: {
      rxBytesPerSec: 0,
      txBytesPerSec: 0,
      interfaces: [],
    },
    gpu: {
      available: true,
      totalMemoryMB: 24576,
      usedMemoryMB: 8192,
      memoryUsagePercent: 33.33,
      utilizationPercent: 60,
      temperatureC: 50,
      gpuCount: 1,
    },
    processes: [],
    docker: [],
    system: {
      hostname: 'gpu-01',
      uptime: '1 day',
      loadAvg1: 0.1,
      loadAvg5: 0.2,
      loadAvg15: 0.3,
      kernelVersion: '6.8.0',
    },
    ...overrides,
  };
}

describe('agent protocol', () => {
  it('accepts a valid register payload', () => {
    expect(isAgentRegisterPayload({
      agentId: 'agent-1',
      hostname: 'gpu-01',
      version: '0.1.0',
    })).toBe(true);
  });

  it('accepts a valid task update payload', () => {
    expect(isAgentTaskUpdatePayload({
      serverId: 'server-1',
      taskId: 'task-1',
      status: 'running',
      command: 'python train.py',
      user: 'alice',
      priority: 5,
      createdAt: 1712010000,
      startedAt: 1712010010,
      pid: 1234,
    })).toBe(true);
  });

  it('accepts a valid local users payload', () => {
    expect(isAgentLocalUsersPayload({
      serverId: 'server-1',
      agentId: 'agent-1',
      timestamp: 1712010000,
      users: [
        {
          username: 'alice',
          uid: 1000,
          gid: 1000,
          gecos: 'Alice Example',
          home: '/home/alice',
          shell: '/bin/bash',
        },
      ],
    })).toBe(true);
  });

  it('accepts metrics payloads with optional gpuAllocation', () => {
    const payload = createSnapshot({
      gpuAllocation: {
        perGpu: [
          {
            gpuIndex: 0,
            totalMemoryMB: 24576,
            pmeowTasks: [
              {
                taskId: 'task-1',
                gpuIndex: 0,
                declaredVramMB: 8192,
                actualVramMB: 6144,
              },
            ],
            userProcesses: [
              {
                pid: 2201,
                user: 'alice',
                gpuIndex: 0,
                usedMemoryMB: 1024,
                command: 'python monitor.py',
              },
            ],
            unknownProcesses: [
              {
                pid: 991,
                gpuIndex: 0,
                usedMemoryMB: 512,
              },
            ],
            effectiveFreeMB: 16896,
          },
        ],
        byUser: [
          {
            user: 'alice',
            totalVramMB: 7168,
            gpuIndices: [0],
          },
        ],
      },
    });

    expect(isAgentMetricsEnvelope({
      event: AGENT_EVENT.metrics,
      data: payload,
    })).toBe(true);
  });

  it('rejects malformed command payloads', () => {
    expect(isServerCommandEnvelope({
      event: SERVER_COMMAND.setPriority,
      data: {
        taskId: 'task-1',
        priority: 'high',
      },
    })).toBe(false);
  });
});
