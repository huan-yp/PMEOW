import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GpuBar } from '../src/components/GpuBar.js';
import type { GpuCardReport, TaskInfo } from '../src/transport/types.js';

function createGpuCard(overrides: Partial<GpuCardReport> = {}): GpuCardReport {
  return {
    index: 0,
    name: 'RTX 4090',
    temperature: 61,
    utilizationGpu: 52,
    utilizationMemory: 40,
    memoryTotalMb: 24576,
    memoryUsedMb: 8192,
    managedReservedMb: 4096,
    unmanagedPeakMb: 1024,
    effectiveFreeMb: 15360,
    taskAllocations: [{ taskId: 'task-1', declaredVramMb: 4096 }],
    userProcesses: [{ pid: 2001, user: 'alice', vramMb: 1024 }],
    unknownProcesses: [{ pid: 3001, vramMb: 512 }],
    ...overrides,
  };
}

function createTask(overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    taskId: 'task-1',
    status: 'running',
    command: 'python train.py',
    cwd: '/workspace',
    user: 'alice',
    launchMode: 'attached_python',
    requireVramMb: 4096,
    requireGpuCount: 1,
    gpuIds: [0],
    priority: 1,
    createdAt: 1,
    startedAt: 2,
    pid: 1234,
    assignedGpus: [0],
    declaredVramPerGpu: 4096,
    scheduleHistory: [],
    ...overrides,
  };
}

describe('GpuBar', () => {
  it('renders a gpu bar without repeating the shared user legend', () => {
    render(<GpuBar gpu={createGpuCard()} tasks={[createTask()]} />);

    expect(screen.getByText('GPU 0: RTX 4090')).toBeTruthy();
    expect(screen.getByText('实际已用 8.0 GB')).toBeTruthy();
    expect(screen.queryByText('alice')).toBeNull();
  });

  it('still renders historical gpu stats without in-card ownership note', () => {
    render(<GpuBar gpu={createGpuCard()} historical />);

    expect(screen.getByText('GPU 0: RTX 4090')).toBeTruthy();
    expect(screen.queryByText('历史快照缺少任务归属，托管任务以未归因分组展示。')).toBeNull();
  });
});