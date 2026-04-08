import { describe, it, expect, vi } from 'vitest';
import { collectNetwork, parseProbeSection } from '../../src/ssh/collectors/network.js';

const NET_DEV_OUTPUT = [
  // First snapshot
  '  eth0: 1000 0 0 0 0 0 0 0 2000 0 0 0 0 0 0 0',
  '    lo: 500 0 0 0 0 0 0 0 500 0 0 0 0 0 0 0',
  // Second snapshot (after sleep 0.5)
  '  eth0: 1500 0 0 0 0 0 0 0 3000 0 0 0 0 0 0 0',
  '    lo: 600 0 0 0 0 0 0 0 600 0 0 0 0 0 0 0',
].join('\n');

describe('collectNetwork', () => {
  it('parses /proc/net/dev and internet probe when both succeed', async () => {
    const probeOutput = [
      '',
      'real 0.05',
      'user 0.00',
      'sys 0.00',
      'EXIT=0',
    ].join('\n');

    const ssh = {
      exec: vi.fn(async () => `${NET_DEV_OUTPUT}\n---PROBE---\n${probeOutput}`),
    } as any;

    const result = await collectNetwork(ssh, 'srv-1');

    expect(result.rxBytesPerSec).toBe(Math.round(500 / 0.5));
    expect(result.txBytesPerSec).toBe(Math.round(1000 / 0.5));
    expect(result.interfaces).toEqual([
      { name: 'eth0', rxBytes: 1500, txBytes: 3000 },
    ]);
    expect(result.internetReachable).toBe(true);
    expect(result.internetLatencyMs).toBe(50.0);
    expect(result.internetProbeTarget).toBe('1.1.1.1:443');
    expect(result.internetProbeCheckedAt).toBeTypeOf('number');
  });

  it('marks unreachable when probe exits non-zero', async () => {
    const probeOutput = [
      '',
      'real 3.01',
      'user 0.00',
      'sys 0.00',
      'EXIT=124',
    ].join('\n');

    const ssh = {
      exec: vi.fn(async () => `${NET_DEV_OUTPUT}\n---PROBE---\n${probeOutput}`),
    } as any;

    const result = await collectNetwork(ssh, 'srv-1');

    expect(result.internetReachable).toBe(false);
    expect(result.internetLatencyMs).toBeNull();
  });

  it('does not set internet fields when probe is disabled', async () => {
    const ssh = {
      exec: vi.fn(async () => `${NET_DEV_OUTPUT}\n---PROBE---\nDISABLED`),
    } as any;

    const result = await collectNetwork(ssh, 'srv-1', { probeTarget: '' });

    expect(result.internetReachable).toBeUndefined();
    expect(result.internetLatencyMs).toBeUndefined();
    expect(result.internetProbeTarget).toBeUndefined();
  });

  it('handles missing probe section gracefully', async () => {
    // Legacy or broken SSH output that does not include the marker
    const ssh = {
      exec: vi.fn(async () => NET_DEV_OUTPUT),
    } as any;

    // Without probeTarget we still set the fields even if the probe section
    // is empty (the default probeTarget is "1.1.1.1:443").
    const result = await collectNetwork(ssh, 'srv-1');

    // Should still parse network metrics correctly
    expect(result.rxBytesPerSec).toBe(Math.round(500 / 0.5));
    // Probe section is empty string, so it reports unreachable
    expect(result.internetReachable).toBe(false);
    expect(result.internetLatencyMs).toBeNull();
  });
});

describe('parseProbeSection', () => {
  it('parses a successful probe with latency', () => {
    const section = `
real 0.12
user 0.00
sys 0.00
EXIT=0`;
    const result = parseProbeSection(section, '1.1.1.1:443');
    expect(result.reachable).toBe(true);
    expect(result.latencyMs).toBe(120.0);
  });

  it('returns unreachable on timeout (exit 124)', () => {
    const section = `
real 3.01
user 0.00
sys 0.00
EXIT=124`;
    const result = parseProbeSection(section, '1.1.1.1:443');
    expect(result.reachable).toBe(false);
    expect(result.latencyMs).toBeNull();
  });

  it('returns unreachable on empty section', () => {
    const result = parseProbeSection('', '1.1.1.1:443');
    expect(result.reachable).toBe(false);
    expect(result.latencyMs).toBeNull();
  });

  it('handles DISABLED marker', () => {
    const result = parseProbeSection('DISABLED', '1.1.1.1:443');
    expect(result.reachable).toBe(false);
    expect(result.latencyMs).toBeNull();
  });

  it('handles missing real line but successful exit', () => {
    const section = 'EXIT=0';
    const result = parseProbeSection(section, '1.1.1.1:443');
    expect(result.reachable).toBe(true);
    expect(result.latencyMs).toBeNull();
  });

  it('parses sub-millisecond latency accurately', () => {
    const section = `
real 0.00
user 0.00
sys 0.00
EXIT=0`;
    const result = parseProbeSection(section, '1.1.1.1:443');
    expect(result.reachable).toBe(true);
    expect(result.latencyMs).toBe(0.0);
  });
});
