import type { SSHManager } from '../manager.js';
import type { GpuMetrics } from '../../types.js';

export async function collectGpu(ssh: SSHManager, serverId: string): Promise<GpuMetrics> {
  try {
    const output = await ssh.exec(
      serverId,
      'nvidia-smi --query-gpu=memory.total,memory.used,utilization.gpu,temperature.gpu --format=csv,noheader,nounits 2>/dev/null'
    );

    const lines = output.trim().split('\n').filter(l => l.trim());
    if (lines.length === 0) {
      return unavailable();
    }

    let totalMem = 0;
    let usedMem = 0;
    let totalUtil = 0;
    let maxTemp = 0;
    let count = 0;

    for (const line of lines) {
      const parts = line.split(',').map(s => s.trim());
      if (parts.length >= 4) {
        totalMem += parseFloat(parts[0]) || 0;
        usedMem += parseFloat(parts[1]) || 0;
        totalUtil += parseFloat(parts[2]) || 0;
        maxTemp = Math.max(maxTemp, parseFloat(parts[3]) || 0);
        count++;
      }
    }

    if (count === 0) return unavailable();

    return {
      available: true,
      totalMemoryMB: Math.round(totalMem),
      usedMemoryMB: Math.round(usedMem),
      memoryUsagePercent: totalMem > 0 ? Math.round((usedMem / totalMem) * 10000) / 100 : 0,
      utilizationPercent: Math.round((totalUtil / count) * 100) / 100,
      temperatureC: maxTemp,
      gpuCount: count,
    };
  } catch {
    return unavailable();
  }
}

function unavailable(): GpuMetrics {
  return {
    available: false,
    totalMemoryMB: 0,
    usedMemoryMB: 0,
    memoryUsagePercent: 0,
    utilizationPercent: 0,
    temperatureC: 0,
    gpuCount: 0,
  };
}
