import fs from 'fs';
import os from 'os';
import { SSHManager } from '../ssh/manager.js';
import * as collectors from '../ssh/collectors/index.js';
import type { ServerConfig, MetricsSnapshot, ConnectionStatus } from '../types.js';
import type { NodeDataSource } from './types.js';

export class SSHDataSource implements NodeDataSource {
  readonly type = 'ssh' as const;
  readonly serverId: string;

  private server: ServerConfig;
  private ssh: SSHManager;
  private status: ConnectionStatus = 'disconnected';

  constructor(server: ServerConfig, ssh?: SSHManager) {
    this.server = server;
    this.serverId = server.id;
    this.ssh = ssh ?? new SSHManager();
  }

  async connect(): Promise<void> {
    if (this.ssh.isConnected(this.serverId)) {
      this.status = 'connected';
      return;
    }
    this.status = 'connecting';
    try {
      const keyPath = this.server.privateKeyPath.replace(/^~/, os.homedir());
      const keyBuffer = fs.readFileSync(keyPath);
      await this.ssh.connect(this.server, keyBuffer);
      this.status = 'connected';
    } catch (err) {
      this.status = 'error';
      throw err;
    }
  }

  disconnect(): void {
    this.ssh.disconnect(this.serverId);
    this.status = 'disconnected';
  }

  isConnected(): boolean {
    return this.ssh.isConnected(this.serverId);
  }

  getConnectionStatus(): ConnectionStatus {
    return this.status;
  }

  async collectMetrics(): Promise<MetricsSnapshot | null> {
    if (!this.isConnected()) {
      await this.connect();
    }

    const [cpu, memory, disk, network, gpu, processes, docker, system] = await Promise.all([
      collectors.collectCpu(this.ssh, this.serverId),
      collectors.collectMemory(this.ssh, this.serverId),
      collectors.collectDisk(this.ssh, this.serverId),
      collectors.collectNetwork(this.ssh, this.serverId),
      collectors.collectGpu(this.ssh, this.serverId),
      collectors.collectProcesses(this.ssh, this.serverId),
      collectors.collectDocker(this.ssh, this.serverId),
      collectors.collectSystem(this.ssh, this.serverId),
    ]);

    return {
      serverId: this.serverId,
      timestamp: Date.now(),
      cpu, memory, disk, network, gpu, processes, docker, system,
    };
  }

  getSSHManager(): SSHManager {
    return this.ssh;
  }

  updateServer(server: ServerConfig): void {
    this.server = server;
  }
}
