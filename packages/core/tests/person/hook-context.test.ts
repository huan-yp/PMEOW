import { describe, expect, it } from 'vitest';
import { executeAction, setNotifyCallback } from '../../src/hooks/actions.js';

describe('person hook template context', () => {
  it('replaces person fields and keeps empty strings for unassigned data', async () => {
    let capturedTitle = '';
    let capturedBody = '';
    setNotifyCallback((title, body) => {
      capturedTitle = title;
      capturedBody = body;
    });

    await executeAction({
      type: 'desktop_notify',
      title: '{{personName}}|{{rawUser}}',
      body: '{{personEmail}}|{{resolutionSource}}',
    }, {
      serverName: 'gpu-1',
      serverHost: 'gpu-1',
      gpuMemUsage: 10,
      gpuUtil: 20,
      gpuIdleMinutes: 3,
      timestamp: '2026-04-03T00:00:00.000Z',
      cpuUsage: 30,
      memUsage: 40,
      personId: '',
      personName: '',
      personEmail: '',
      personQQ: '',
      personNote: '',
      personCustomFieldsJson: '',
      rawUser: 'alice',
      taskId: '',
      resolutionSource: 'unassigned',
    });

    expect(capturedTitle).toBe('|alice');
    expect(capturedBody).toBe('|unassigned');
  });
});
