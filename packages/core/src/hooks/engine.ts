import { evaluateCondition, getGpuIdleMinutes } from './conditions.js';
import { executeAction } from './actions.js';
import { getHooksByServerId, setHookLastTriggered, addHookLog } from '../db/hooks.js';
import { getServerById } from '../db/servers.js';
import type { MetricsSnapshot, TemplateContext, HookLog } from '../types.js';

// Track which hooks are currently in "triggered" state (edge-trigger debounce)
const triggeredState = new Map<string, boolean>();

export type HookTriggeredCallback = (log: HookLog) => void;

let onHookTriggered: HookTriggeredCallback = () => {};

export function setHookTriggeredCallback(cb: HookTriggeredCallback): void {
  onHookTriggered = cb;
}

export async function evaluateHooks(metrics: MetricsSnapshot): Promise<void> {
  const hooks = getHooksByServerId(metrics.serverId);

  for (const hook of hooks) {
    if (!hook.enabled) continue;

    const conditionMet = evaluateCondition(hook.condition, metrics);
    const wasTriggered = triggeredState.get(hook.id) ?? false;

    if (conditionMet && !wasTriggered) {
      // Edge trigger: condition just became true
      triggeredState.set(hook.id, true);

      const server = getServerById(hook.condition.serverId);
      const context: TemplateContext = {
        serverName: server?.name ?? 'unknown',
        serverHost: server?.host ?? 'unknown',
        gpuMemUsage: metrics.gpu.memoryUsagePercent,
        gpuUtil: metrics.gpu.utilizationPercent,
        gpuIdleMinutes: getGpuIdleMinutes(metrics.serverId),
        timestamp: new Date().toISOString(),
        cpuUsage: metrics.cpu.usagePercent,
        memUsage: metrics.memory.usagePercent,
        personId: '',
        personName: '',
        personEmail: '',
        personQQ: '',
        personNote: '',
        personCustomFieldsJson: '',
        rawUser: '',
        taskId: '',
        resolutionSource: 'unassigned',
      };

      try {
        const result = await executeAction(hook.action, context);
        const now = Date.now();
        setHookLastTriggered(hook.id, now);
        const log = addHookLog(hook.id, true, result, null);
        onHookTriggered(log);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const log = addHookLog(hook.id, false, '', errMsg);
        onHookTriggered(log);
      }
    } else if (!conditionMet && wasTriggered) {
      // Condition no longer met, allow re-trigger
      triggeredState.set(hook.id, false);
    }
  }
}

export function resetHookState(hookId: string): void {
  triggeredState.delete(hookId);
}
