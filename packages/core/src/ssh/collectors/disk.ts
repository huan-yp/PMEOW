import type { SSHManager } from '../manager.js';
import type { DiskMetrics, DiskInfo } from '../../types.js';

export async function collectDisk(ssh: SSHManager, serverId: string): Promise<DiskMetrics> {
  const script = `
    df -BG --output=source,target,size,used,avail,pcent -x tmpfs -x devtmpfs -x squashfs 2>/dev/null | tail -n+2
    echo "---DISKIO---"
    cat /proc/diskstats
    sleep 0.5
    cat /proc/diskstats
  `;
  const output = await ssh.exec(serverId, script);
  const sections = output.split('---DISKIO---');

  // Parse df output
  const dfLines = sections[0].trim().split('\n').filter(l => l.trim());
  const disks: DiskInfo[] = dfLines.map(line => {
    const parts = line.trim().split(/\s+/);
    return {
      filesystem: parts[0] || '',
      mountPoint: parts[1] || '',
      totalGB: parseFloat(parts[2]) || 0,
      usedGB: parseFloat(parts[3]) || 0,
      availableGB: parseFloat(parts[4]) || 0,
      usagePercent: parseInt(parts[5]) || 0,
    };
  });

  // Parse disk IO (two snapshots 0.5s apart)
  let ioReadKBs = 0;
  let ioWriteKBs = 0;

  if (sections[1]) {
    const ioLines = sections[1].trim().split('\n');
    const half = Math.floor(ioLines.length / 2);
    const snapshot1 = parseDiskStats(ioLines.slice(0, half));
    const snapshot2 = parseDiskStats(ioLines.slice(half));

    let readDiff = 0;
    let writeDiff = 0;
    for (const [dev, s2] of snapshot2) {
      const s1 = snapshot1.get(dev);
      if (s1) {
        readDiff += s2.readSectors - s1.readSectors;
        writeDiff += s2.writeSectors - s1.writeSectors;
      }
    }
    // Sectors are 512 bytes, interval is 0.5s
    ioReadKBs = Math.round((readDiff * 512) / 1024 / 0.5);
    ioWriteKBs = Math.round((writeDiff * 512) / 1024 / 0.5);
  }

  return { disks, ioReadKBs, ioWriteKBs };
}

function parseDiskStats(lines: string[]): Map<string, { readSectors: number; writeSectors: number }> {
  const result = new Map<string, { readSectors: number; writeSectors: number }>();
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 14) {
      const dev = parts[2];
      // Only consider sd*, nvme*, vd* (actual disks, not partitions by convention)
      if (/^(sd[a-z]|nvme\d+n\d+|vd[a-z])$/.test(dev)) {
        result.set(dev, {
          readSectors: parseInt(parts[5]) || 0,
          writeSectors: parseInt(parts[9]) || 0,
        });
      }
    }
  }
  return result;
}
