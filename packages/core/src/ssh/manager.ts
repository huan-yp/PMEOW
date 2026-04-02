import { Client, ConnectConfig } from 'ssh2';
import type { ServerConfig } from '../types.js';

interface PoolEntry {
  client: Client;
  connected: boolean;
  lastUsed: number;
}

export class SSHManager {
  private pool = new Map<string, PoolEntry>();
  private connectingMap = new Map<string, Promise<Client>>();

  async connect(server: ServerConfig, privateKey: Buffer): Promise<Client> {
    const existing = this.pool.get(server.id);
    if (existing?.connected) {
      existing.lastUsed = Date.now();
      return existing.client;
    }

    // Avoid duplicate concurrent connections
    const pending = this.connectingMap.get(server.id);
    if (pending) return pending;

    const promise = this._doConnect(server, privateKey);
    this.connectingMap.set(server.id, promise);

    try {
      const client = await promise;
      return client;
    } finally {
      this.connectingMap.delete(server.id);
    }
  }

  private _doConnect(server: ServerConfig, privateKey: Buffer): Promise<Client> {
    return new Promise((resolve, reject) => {
      const client = new Client();

      const config: ConnectConfig = {
        host: server.host,
        port: server.port,
        username: server.username,
        privateKey,
        readyTimeout: 10000,
        keepaliveInterval: 30000,
        keepaliveCountMax: 3,
      };

      client
        .on('ready', () => {
          this.pool.set(server.id, { client, connected: true, lastUsed: Date.now() });
          resolve(client);
        })
        .on('error', (err) => {
          this.pool.delete(server.id);
          reject(err);
        })
        .on('close', () => {
          const entry = this.pool.get(server.id);
          if (entry) entry.connected = false;
        })
        .on('end', () => {
          this.pool.delete(server.id);
        })
        .connect(config);
    });
  }

  async exec(serverId: string, command: string): Promise<string> {
    const entry = this.pool.get(serverId);
    if (!entry?.connected) {
      throw new Error(`Server ${serverId} is not connected`);
    }

    return new Promise((resolve, reject) => {
      entry.client.exec(command, (err, stream) => {
        if (err) return reject(err);

        let stdout = '';
        let stderr = '';

        stream
          .on('data', (data: Buffer) => { stdout += data.toString(); })
          .on('close', (code: number) => {
            if (code !== 0 && stderr) {
              reject(new Error(`Command failed (exit ${code}): ${stderr}`));
            } else {
              resolve(stdout);
            }
          })
          .stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
      });
    });
  }

  disconnect(serverId: string): void {
    const entry = this.pool.get(serverId);
    if (entry) {
      entry.client.end();
      this.pool.delete(serverId);
    }
  }

  disconnectAll(): void {
    for (const [id] of this.pool) {
      this.disconnect(id);
    }
  }

  isConnected(serverId: string): boolean {
    return this.pool.get(serverId)?.connected ?? false;
  }
}
