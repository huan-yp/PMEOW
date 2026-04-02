import { describe, it, expect } from 'vitest';
import { AgentDataSource } from '../../src/datasource/agent-datasource.js';

describe('AgentDataSource', () => {
  it('should have type agent', () => {
    const ds = new AgentDataSource('srv-1');
    expect(ds.type).toBe('agent');
    expect(ds.serverId).toBe('srv-1');
  });

  it('should start disconnected', () => {
    const ds = new AgentDataSource('srv-1');
    expect(ds.isConnected()).toBe(false);
    expect(ds.getConnectionStatus()).toBe('disconnected');
  });

  it('should return null from collectMetrics when no data pushed', async () => {
    const ds = new AgentDataSource('srv-1');
    const result = await ds.collectMetrics();
    expect(result).toBeNull();
  });

  it('should return pushed snapshot from collectMetrics', async () => {
    const ds = new AgentDataSource('srv-1');
    const fakeSnapshot = { serverId: 'srv-1', timestamp: 123 } as any;
    ds.pushMetrics(fakeSnapshot);
    const result = await ds.collectMetrics();
    expect(result).toEqual(fakeSnapshot);
  });
});
