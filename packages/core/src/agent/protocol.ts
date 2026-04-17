import { UnifiedReport } from '../types.js';

export const AGENT_EVENT = {
  register: 'agent:register',
  report: 'agent:report',
} as const;

export const SERVER_COMMAND = {
  cancelTask: 'server:cancelTask',
  setPriority: 'server:setPriority',
  requestCollection: 'server:requestCollection',
} as const;

export interface AgentRegisterPayload {
  agentId: string;
  hostname: string;
  version: string;
}

export interface ServerCancelTaskPayload { taskId: string; }
export interface ServerSetPriorityPayload { taskId: string; priority: number; }

export function isAgentRegisterPayload(data: unknown): data is AgentRegisterPayload {
  if (typeof data !== 'object' || data === null) return false;
  const p = data as AgentRegisterPayload;
  return typeof p.agentId === 'string' && typeof p.hostname === 'string';
}

export function isUnifiedReport(data: unknown): data is UnifiedReport {
  if (typeof data !== 'object' || data === null) return false;
  const p = data as UnifiedReport;
  return typeof p.agentId === 'string' && typeof p.timestamp === 'number' && typeof p.resourceSnapshot === 'object';
}
