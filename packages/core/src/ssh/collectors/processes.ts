import type { SSHManager } from '../manager.js';
import type { ProcessInfo } from '../../types.js';

export async function collectProcesses(ssh: SSHManager, serverId: string, topN = 15): Promise<ProcessInfo[]> {
  const output = await ssh.exec(
    serverId,
    `ps aux --sort=-%cpu | head -${topN + 1}`
  );

  const lines = output.trim().split('\n');
  // Skip header line
  const processes: ProcessInfo[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/);
    if (parts.length >= 11) {
      processes.push({
        pid: parseInt(parts[1]) || 0,
        user: parts[0],
        cpuPercent: parseFloat(parts[2]) || 0,
        memPercent: parseFloat(parts[3]) || 0,
        rss: parseInt(parts[5]) || 0,
        command: parts.slice(10).join(' '),
      });
    }
  }

  return processes;
}
