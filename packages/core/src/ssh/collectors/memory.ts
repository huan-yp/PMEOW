import type { SSHManager } from '../manager.js';
import type { MemoryMetrics } from '../../types.js';

export async function collectMemory(ssh: SSHManager, serverId: string): Promise<MemoryMetrics> {
  const output = await ssh.exec(serverId, 'cat /proc/meminfo');
  const lines = output.trim().split('\n');

  const mem: Record<string, number> = {};
  for (const line of lines) {
    const match = line.match(/^(\w+):\s+(\d+)/);
    if (match) {
      mem[match[1]] = parseInt(match[2]); // in kB
    }
  }

  const totalMB = (mem['MemTotal'] || 0) / 1024;
  const availableMB = (mem['MemAvailable'] || 0) / 1024;
  const usedMB = totalMB - availableMB;
  const usagePercent = totalMB > 0 ? Math.round((usedMB / totalMB) * 10000) / 100 : 0;

  const swapTotalMB = (mem['SwapTotal'] || 0) / 1024;
  const swapFreeMB = (mem['SwapFree'] || 0) / 1024;
  const swapUsedMB = swapTotalMB - swapFreeMB;
  const swapPercent = swapTotalMB > 0 ? Math.round((swapUsedMB / swapTotalMB) * 10000) / 100 : 0;

  return {
    totalMB: Math.round(totalMB),
    usedMB: Math.round(usedMB),
    availableMB: Math.round(availableMB),
    usagePercent,
    swapTotalMB: Math.round(swapTotalMB),
    swapUsedMB: Math.round(swapUsedMB),
    swapPercent,
  };
}
