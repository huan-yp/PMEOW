// Core package - public API
export * from './types.js';
export type {
	AgentTaskQueueGroup,
	GpuOverviewResponse,
	GpuOverviewServerSummary,
	GpuOverviewUserSummary,
	GpuUsageSummaryItem,
	GpuUsageTimelinePoint,
	ProcessAuditRow,
	SecurityEventDetails,
	SecurityEventRecord,
	SecurityEventType,
	ServerStatusEvent,
} from './types.js';
export * from './agent/protocol.js';
export { resolveAgentBinding, autoCreateAgentServer } from './agent/binding.js';
export type {
	AgentBindingResolution,
	BoundAgentBindingResolution,
	ConflictAgentBindingResolution,
	UnmatchedAgentBindingResolution,
} from './agent/binding.js';
export { AgentSessionRegistry } from './agent/registry.js';
export type { AgentLiveSession } from './agent/registry.js';
export { ingestAgentMetrics, ingestAgentTaskUpdate, ingestAgentLocalUsers, flattenGpuAllocation } from './agent/ingest.js';
export { SSHManager } from './ssh/manager.js';
export * as collectors from './ssh/collectors/index.js';
export { getDatabase, closeDatabase } from './db/database.js';
export { upsertAgentTask, getAgentTask, getAgentTasksByServerId, deleteAgentTasksByServerId, getAgentTaskQueueGroups } from './db/agent-tasks.js';
export {
	saveGpuUsageRows,
	getLatestGpuUsageByServerId,
	getGpuOverview,
	getGpuUsageSummary,
	getGpuUsageTimelineByUser,
	getLatestUnownedGpuDurationMinutes,
	cleanOldGpuUsage,
} from './db/gpu-usage.js';
export type { GpuUsageRowInput, StoredGpuUsageRow } from './db/gpu-usage.js';
export {
	createSecurityEvent,
	findOpenSecurityEvent,
	listSecurityEvents,
	markSecurityEventSafe,
} from './db/security-events.js';
export type { SecurityEventInput, SecurityEventQuery } from './db/security-events.js';
export {
	getAllServers,
	getServerById,
	getServerByAgentId,
	getServersByHost,
	createServer,
	updateServer,
	bindAgentToServer,
	deleteServer,
} from './db/servers.js';
export { saveMetrics, getLatestMetrics, getMetricsHistory, cleanOldMetrics } from './db/metrics.js';
export { replaceServerLocalUsers, listServerLocalUsers } from './db/server-local-users.js';
export { getAllHooks, getHookById, getHooksByServerId, createHook, updateHook, deleteHook, getHookLogs, addHookLog } from './db/hooks.js';
export {
	getSettings,
	saveSetting,
	saveSettings,
} from './db/settings.js';
export { insertServerStatusEvent, listServerStatusEvents } from './db/server-status-events.js';
export { Scheduler } from './scheduler.js';
export { setAlertCallback } from './alerts.js';
export { saveAlert, getAlerts, suppressAlert, getActiveSuppressions, cleanExpiredAlerts } from './db/alerts.js';
export { setNotifyCallback } from './hooks/actions.js';
export { setHookTriggeredCallback, resetHookState } from './hooks/engine.js';
export { evaluateCondition, getGpuIdleMinutes, resetIdleTracking } from './hooks/conditions.js';
export { executeAction } from './hooks/actions.js';
export type { NodeDataSource, AgentCommandDataSource } from './datasource/types.js';
export { isAgentCommandDataSource } from './datasource/types.js';
export { SSHDataSource } from './datasource/ssh-datasource.js';
export { AgentDataSource } from './datasource/agent-datasource.js';
export { createDataSource } from './datasource/factory.js';
export { buildProcessAuditRows } from './security/audit.js';
export { buildSecurityFingerprint, analyzeSecuritySnapshot } from './security/analyzer.js';
export { processSecuritySnapshot } from './security/pipeline.js';
export {
  createPerson,
  getPersonById,
  listPersons,
  updatePerson,
  archivePerson,
  createPersonBinding,
  listPersonBindings,
  updatePersonBinding,
  getActivePersonBinding,
  setTaskOwnerOverride,
  getTaskOwnerOverride,
  getActiveTaskOwnerOverride,
} from './db/persons.js';
export { resolveTaskPerson, resolveRawUserPerson } from './person/resolve.js';
export { writeAttributionFacts } from './person/attribution.js';
export {
  insertPersonAttributionFacts,
  recordGpuAttributionFacts,
  recordTaskAttributionFact,
  getPersonSummaries,
  getPersonTimeline,
  getPersonTasks,
  getServerPersonActivity,
	listPersonBindingCandidates,
  listPersonBindingSuggestions,
  getResolvedGpuAllocation,
} from './db/person-attribution.js';
export {
  createPersonMobileToken,
  rotatePersonMobileToken,
  revokePersonMobileToken,
  resolvePersonMobileToken,
  getPersonMobileTokenStatus,
} from './db/person-mobile-tokens.js';
export type { CreatePersonMobileTokenResult } from './db/person-mobile-tokens.js';
export {
  getPersonMobilePreferences,
  updatePersonMobilePreferences,
} from './db/person-mobile-preferences.js';
export {
  createPersonMobileNotification,
  getPersonMobileNotifications,
  getPersonUnreadNotificationCount,
  markPersonNotificationRead,
} from './db/person-mobile-notifications.js';
export type { CreateNotificationInput } from './db/person-mobile-notifications.js';
export {
  buildTaskNotificationEvent,
  buildNodeStatusNotificationEvent,
  buildGpuAvailabilityNotificationEvent,
  shouldNotifyForTask,
} from './mobile/notification-policies.js';
