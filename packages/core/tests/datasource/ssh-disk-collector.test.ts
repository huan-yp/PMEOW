import { describe, expect, it, vi } from 'vitest';
import { collectDisk } from '../../src/ssh/collectors/disk.js';

describe('collectDisk', () => {
  it('filters noisy mount paths from df output', async () => {
    const ssh = {
      exec: vi.fn(async () => [
        '/dev/sda1 / 100G 34G 66G 34%',
        '/dev/sdb1 /data 500G 120G 380G 24%',
        'docker-desktop /mnt/wsl/docker-desktop/cli-tools 1G 1G 0G 100%',
        'docker-bind /mnt/wsl/docker-desktop-bind-mounts/Ubuntu/hash 100G 34G 66G 34%',
        'overlay /var/lib/docker 100G 34G 66G 34%',
        '/dev/sdc1 /mnt/wslg/distro 100G 34G 66G 34%',
        '---DISKIO---',
        '8 0 sda 0 0 100 0 0 0 200 0 0 0 0 0 0 0',
        '8 0 sda 0 0 100 0 0 0 200 0 0 0 0 0 0 0',
      ].join('\n')),
    } as any;

    const result = await collectDisk(ssh, 'server-1');

    expect(result).toEqual({
      disks: [
        {
          filesystem: '/dev/sda1',
          mountPoint: '/',
          totalGB: 100,
          usedGB: 34,
          availableGB: 66,
          usagePercent: 34,
        },
        {
          filesystem: '/dev/sdb1',
          mountPoint: '/data',
          totalGB: 500,
          usedGB: 120,
          availableGB: 380,
          usagePercent: 24,
        },
      ],
      ioReadKBs: 0,
      ioWriteKBs: 0,
    });
  });
});