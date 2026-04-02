import type { SSHManager } from '../manager.js';
import type { DockerContainer } from '../../types.js';

export async function collectDocker(ssh: SSHManager, serverId: string): Promise<DockerContainer[]> {
  try {
    const output = await ssh.exec(
      serverId,
      `docker ps -a --format '{"id":"{{.ID}}","name":"{{.Names}}","image":"{{.Image}}","status":"{{.Status}}","state":"{{.State}}","ports":"{{.Ports}}","createdAt":"{{.CreatedAt}}"}' 2>/dev/null`
    );

    const lines = output.trim().split('\n').filter(l => l.trim());
    const containers: DockerContainer[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        containers.push({
          id: parsed.id || '',
          name: parsed.name || '',
          image: parsed.image || '',
          status: parsed.status || '',
          state: parsed.state || '',
          ports: parsed.ports || '',
          createdAt: parsed.createdAt || '',
        });
      } catch {
        // Skip malformed lines
      }
    }

    return containers;
  } catch {
    return [];
  }
}
