import type { SSHManager } from '../manager.js';
import type { SystemMetrics } from '../../types.js';

export async function collectSystem(ssh: SSHManager, serverId: string): Promise<SystemMetrics> {
  const script = `
    hostname
    uptime -p 2>/dev/null || uptime
    cat /proc/loadavg
    uname -r
  `;
  const output = await ssh.exec(serverId, script);
  const lines = output.trim().split('\n');

  const hostname = lines[0]?.trim() || 'unknown';
  const uptime = lines[1]?.trim() || '';
  const loadParts = (lines[2] || '').trim().split(/\s+/);
  const kernelVersion = lines[3]?.trim() || '';

  return {
    hostname,
    uptime,
    loadAvg1: parseFloat(loadParts[0]) || 0,
    loadAvg5: parseFloat(loadParts[1]) || 0,
    loadAvg15: parseFloat(loadParts[2]) || 0,
    kernelVersion,
  };
}
