// Types
export * from "./types.js";

// DB
export { getDatabase, closeDatabase } from "./db/database.js";
export { getAllServers, getServerById, getServerByAgentId, createServer, updateServer, deleteServer } from "./db/servers.js";
export { saveSnapshot, deleteOldRecentSnapshots, getSnapshotHistory, getLatestSnapshot } from "./db/snapshots.js";
export type { SnapshotWithGpus } from "./db/snapshots.js";
export { upsertTask, endTask, updateTaskPriority, updateTaskScheduleHistory } from "./db/tasks.js";
export { getAlerts, getActiveAlerts, getAlertByKey, reconcileAlerts, silenceAlert, unsilenceAlert, batchSilenceAlerts, batchUnsilenceAlerts, deleteAlertsByServerId } from "./db/alerts.js";
export { createSecurityEvent, findOpenSecurityEvent, listSecurityEvents, markSecurityEventSafe, unresolveSecurityEvent } from "./db/security-events.js";
export type { SecurityEventInput, SecurityEventQuery } from "./db/security-events.js";
export { createPerson, getPersonById, listPersons, updatePerson } from "./db/persons.js";
export { createBinding, updateBinding, getBindingsByPersonId, getActiveBinding, deactivateBinding, listBindingCandidates } from "./db/person-bindings.js";
export { createPersonToken, getPersonTokenById, getPersonTokensByPersonId, verifyPersonToken, revokePersonToken, rotatePersonToken } from "./db/person-tokens.js";
export { getSettings, saveSetting, saveSettings } from "./db/settings.js";

// Agent
export { AGENT_EVENT, SERVER_COMMAND, isAgentRegisterPayload, isUnifiedReport, parseUnifiedReport } from "./agent/protocol.js";
export type { AgentRegisterPayload } from "./agent/protocol.js";
export { AgentCommandError, isAgentCommandError } from "./agent/errors.js";
export type { AgentCommandErrorCode } from "./agent/errors.js";

// Node
export { AgentSessionRegistry } from "./node/registry.js";
export type { AgentSession } from "./node/registry.js";
export { createAgentSession } from "./node/session.js";

// Ingest
export { IngestPipeline } from "./ingest/pipeline.js";
export type { IngestCallbacks } from "./ingest/pipeline.js";
export { SnapshotScheduler } from "./ingest/snapshot-scheduler.js";

// Task
export { TaskEngine } from "./task/engine.js";
export { diffTasks } from "./task/differ.js";
export type { TaskDiffResult } from "./task/differ.js";
export { listTasks, getTask, countTasks, cancelTask, setPriority } from "./task/service.js";
export type { TaskFilter } from "./task/service.js";
export type { TaskEvent, TaskEventType } from "./task/events.js";

// Alert
export { AlertEngine } from "./alert/engine.js";
export { AlertStateStore } from "./alert/state-store.js";

// Security
export { analyzeReport } from "./security/analyzer.js";
export type { SecurityFinding } from "./security/analyzer.js";
export { processSecurityCheck } from "./security/pipeline.js";

// Person
export { createPersonFromWizard, getPersonTimeline, getPersonTasks, getPersonDirectory, PersonWizardConflictError, autoAddUnassignedUsers } from "./person/service.js";
export { resolveRawUserPerson } from "./person/resolve.js";
export { canAccessServer, canAccessTask, getAccessibleServerIds } from "./person/scope.js";
