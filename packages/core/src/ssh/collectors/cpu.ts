import type { SSHManager } from '../manager.js';
import type { CpuMetrics } from '../../types.js';

// We take two snapshots of /proc/stat ~500ms apart to compute usage
export async function collectCpu(ssh: SSHManager, serverId: string): Promise<CpuMetrics> {
  const script = `
    cat /proc/stat | head -1
    sleep 0.5
    cat /proc/stat | head -1
    echo "---CPUINFO---"
    grep -c ^processor /proc/cpuinfo
    grep 'model name' /proc/cpuinfo | head -1 | cut -d: -f2
    grep 'cpu MHz' /proc/cpuinfo | head -1 | cut -d: -f2
    echo "---PERCPU---"
    cat /proc/stat | grep '^cpu[0-9]'
    sleep 0.5
    cat /proc/stat | grep '^cpu[0-9]'
  `;
  const output = await ssh.exec(serverId, script);
  const lines = output.trim().split('\n');

  // Parse overall CPU
  const cpuLine1 = parseCpuLine(lines[0]);
  const cpuLine2 = parseCpuLine(lines[1]);
  const usagePercent = calculateUsage(cpuLine1, cpuLine2);

  // Parse CPU info
  const infoIdx = lines.indexOf('---CPUINFO---');
  const coreCount = parseInt(lines[infoIdx + 1]) || 1;
  const modelName = (lines[infoIdx + 2] || '').trim();
  const frequencyMhz = parseFloat(lines[infoIdx + 3]) || 0;

  // Parse per-core usage
  const perCoreIdx = lines.indexOf('---PERCPU---');
  const perCoreLines = lines.slice(perCoreIdx + 1);
  const half = Math.floor(perCoreLines.length / 2);
  const perCoreUsage: number[] = [];
  for (let i = 0; i < half; i++) {
    const before = parseCpuLine(perCoreLines[i]);
    const after = parseCpuLine(perCoreLines[i + half]);
    perCoreUsage.push(calculateUsage(before, after));
  }

  return { usagePercent, coreCount, modelName, frequencyMhz, perCoreUsage };
}

interface CpuTimes { user: number; nice: number; system: number; idle: number; iowait: number; irq: number; softirq: number; steal: number; }

function parseCpuLine(line: string): CpuTimes {
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  return {
    user: parts[0] || 0, nice: parts[1] || 0, system: parts[2] || 0,
    idle: parts[3] || 0, iowait: parts[4] || 0, irq: parts[5] || 0,
    softirq: parts[6] || 0, steal: parts[7] || 0,
  };
}

function calculateUsage(t1: CpuTimes, t2: CpuTimes): number {
  const idle1 = t1.idle + t1.iowait;
  const idle2 = t2.idle + t2.iowait;
  const total1 = t1.user + t1.nice + t1.system + t1.idle + t1.iowait + t1.irq + t1.softirq + t1.steal;
  const total2 = t2.user + t2.nice + t2.system + t2.idle + t2.iowait + t2.irq + t2.softirq + t2.steal;
  const totalDiff = total2 - total1;
  const idleDiff = idle2 - idle1;
  if (totalDiff === 0) return 0;
  return Math.round(((totalDiff - idleDiff) / totalDiff) * 10000) / 100;
}
