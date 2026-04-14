import { describe, expect, it } from 'vitest';
import { saveAlert, getAlerts, suppressAlert, unsuppressAlert, batchSuppressAlerts, batchUnsuppressAlerts } from '../../src/db/alerts.js';

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

describe('getAlerts with suppressed filter', () => {
  it('returns only suppressed alerts when suppressed=true', () => {
    const futureMs = Date.now() + 7 * 24 * 60 * 60 * 1000;

    saveAlert({ id: 'flt-1', serverId: 's', serverName: 'n', metric: 'cpu', value: 90, threshold: 80, timestamp: Date.now(), suppressedUntil: null });
    saveAlert({ id: 'flt-2', serverId: 's', serverName: 'n', metric: 'mem', value: 90, threshold: 80, timestamp: Date.now(), suppressedUntil: null });
    suppressAlert('flt-1', futureMs);

    const suppressed = getAlerts({ suppressed: true });
    const ids = suppressed.map(a => a.id);
    expect(ids).toContain('flt-1');
    expect(ids).not.toContain('flt-2');
  });

  it('returns only active alerts when suppressed=false', () => {
    const futureMs = Date.now() + 7 * 24 * 60 * 60 * 1000;

    saveAlert({ id: 'flt-3', serverId: 's', serverName: 'n', metric: 'cpu', value: 90, threshold: 80, timestamp: Date.now(), suppressedUntil: null });
    saveAlert({ id: 'flt-4', serverId: 's', serverName: 'n', metric: 'mem', value: 90, threshold: 80, timestamp: Date.now(), suppressedUntil: null });
    suppressAlert('flt-3', futureMs);

    const active = getAlerts({ suppressed: false });
    const ids = active.map(a => a.id);
    expect(ids).not.toContain('flt-3');
    expect(ids).toContain('flt-4');
  });
});

describe('batchSuppressAlerts and batchUnsuppressAlerts', () => {
  it('batch suppresses multiple alerts', () => {
    const futureMs = Date.now() + 7 * 24 * 60 * 60 * 1000;

    saveAlert({ id: 'bat-1', serverId: 's', serverName: 'n', metric: 'cpu', value: 90, threshold: 80, timestamp: Date.now(), suppressedUntil: null });
    saveAlert({ id: 'bat-2', serverId: 's', serverName: 'n', metric: 'mem', value: 90, threshold: 80, timestamp: Date.now(), suppressedUntil: null });
    saveAlert({ id: 'bat-3', serverId: 's', serverName: 'n', metric: 'disk', value: 90, threshold: 80, timestamp: Date.now(), suppressedUntil: null });

    batchSuppressAlerts(['bat-1', 'bat-2', 'bat-3'], futureMs);

    const all = getAlerts();
    for (const id of ['bat-1', 'bat-2', 'bat-3']) {
      const a = all.find(x => x.id === id);
      expect(a?.suppressedUntil).toBe(futureMs);
    }
  });

  it('batch unsuppresses multiple alerts', () => {
    const futureMs = Date.now() + 7 * 24 * 60 * 60 * 1000;

    saveAlert({ id: 'bat-4', serverId: 's', serverName: 'n', metric: 'cpu', value: 90, threshold: 80, timestamp: Date.now(), suppressedUntil: null });
    saveAlert({ id: 'bat-5', serverId: 's', serverName: 'n', metric: 'mem', value: 90, threshold: 80, timestamp: Date.now(), suppressedUntil: null });
    batchSuppressAlerts(['bat-4', 'bat-5'], futureMs);

    batchUnsuppressAlerts(['bat-4', 'bat-5']);

    const all = getAlerts();
    for (const id of ['bat-4', 'bat-5']) {
      const a = all.find(x => x.id === id);
      expect(a?.suppressedUntil).toBeNull();
    }
  });

  it('is a no-op for empty ids array', () => {
    expect(() => batchSuppressAlerts([], Date.now() + 1000)).not.toThrow();
    expect(() => batchUnsuppressAlerts([])).not.toThrow();
  });
});
