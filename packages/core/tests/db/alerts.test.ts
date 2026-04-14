import { describe, expect, it } from 'vitest';
import { saveAlert, getAlerts, suppressAlert, unsuppressAlert } from '../../src/db/alerts.js';

describe('alert suppress and unsuppress', () => {
  it('unsuppresses a previously suppressed alert', () => {
    const futureMs = Date.now() + 7 * 24 * 60 * 60 * 1000;

    saveAlert({
      id: 'alert-1',
      serverId: 'srv-1',
      serverName: 'gpu-1',
      metric: 'cpu_usage',
      value: 95,
      threshold: 90,
      timestamp: Date.now(),
      suppressedUntil: null,
    });

    suppressAlert('alert-1', futureMs);

    const afterSuppress = getAlerts();
    const suppressed = afterSuppress.find(a => a.id === 'alert-1');
    expect(suppressed?.suppressedUntil).toBe(futureMs);

    unsuppressAlert('alert-1');

    const afterUnsuppress = getAlerts();
    const unsuppressed = afterUnsuppress.find(a => a.id === 'alert-1');
    expect(unsuppressed?.suppressedUntil).toBeNull();
  });

  it('unsuppress on a non-suppressed alert is a no-op', () => {
    saveAlert({
      id: 'alert-2',
      serverId: 'srv-2',
      serverName: 'gpu-2',
      metric: 'memory_usage',
      value: 85,
      threshold: 80,
      timestamp: Date.now(),
      suppressedUntil: null,
    });

    unsuppressAlert('alert-2');

    const alerts = getAlerts();
    const alert = alerts.find(a => a.id === 'alert-2');
    expect(alert?.suppressedUntil).toBeNull();
  });
});
