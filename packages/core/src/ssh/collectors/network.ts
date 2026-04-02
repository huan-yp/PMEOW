import type { SSHManager } from '../manager.js';
import type { NetworkMetrics } from '../../types.js';

export async function collectNetwork(ssh: SSHManager, serverId: string): Promise<NetworkMetrics> {
  const script = `
    cat /proc/net/dev
    sleep 0.5
    cat /proc/net/dev
  `;
  const output = await ssh.exec(serverId, script);

  // Split into two snapshots by counting header lines
  const lines = output.trim().split('\n');
  const headerCount = 2; // "Inter-|" and "face |bytes..."
  const dataLines = lines.filter(l => l.includes(':') && !l.includes('|'));
  const half = Math.floor(dataLines.length / 2);

  const snapshot1 = parseNetDev(dataLines.slice(0, half));
  const snapshot2 = parseNetDev(dataLines.slice(half));

  let totalRxDiff = 0;
  let totalTxDiff = 0;
  const interfaces: NetworkMetrics['interfaces'] = [];

  for (const [name, s2] of snapshot2) {
    if (name === 'lo') continue; // Skip loopback
    const s1 = snapshot1.get(name);
    if (s1) {
      const rxDiff = s2.rxBytes - s1.rxBytes;
      const txDiff = s2.txBytes - s1.txBytes;
      totalRxDiff += rxDiff;
      totalTxDiff += txDiff;
      interfaces.push({ name, rxBytes: s2.rxBytes, txBytes: s2.txBytes });
    }
  }

  return {
    rxBytesPerSec: Math.round(totalRxDiff / 0.5),
    txBytesPerSec: Math.round(totalTxDiff / 0.5),
    interfaces,
  };
}

function parseNetDev(lines: string[]): Map<string, { rxBytes: number; txBytes: number }> {
  const result = new Map<string, { rxBytes: number; txBytes: number }>();
  for (const line of lines) {
    const match = line.match(/^\s*(\w+):\s+(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/);
    if (match) {
      result.set(match[1], {
        rxBytes: parseInt(match[2]) || 0,
        txBytes: parseInt(match[3]) || 0,
      });
    }
  }
  return result;
}
