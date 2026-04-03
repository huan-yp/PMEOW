import {
  listPersonBindings,
  listPersons,
  getPersonMobilePreferences,
  createPersonMobileNotification,
  buildTaskNotificationEvent,
  buildNodeStatusNotificationEvent,
  shouldNotifyForTask,
  resolveTaskPerson,
  type AgentTaskUpdatePayload,
  type ServerStatus,
} from '@monitor/core';

export function handleTaskUpdateForNotifications(update: AgentTaskUpdatePayload): void {
  const { serverId, taskId, status, user, command } = update;
  if (status === 'queued') return;

  const resolved = resolveTaskPerson(serverId, taskId, user ?? '', Date.now());
  if (!resolved || !resolved.person) return;

  const prefs = getPersonMobilePreferences(resolved.person.id);
  if (!shouldNotifyForTask(prefs, status)) return;

  const event = buildTaskNotificationEvent(resolved.person.id, taskId, serverId, status, command);
  if (event) createPersonMobileNotification(event);
}

export function handleServerStatusForNotifications(serverStatus: ServerStatus): void {
  const online = serverStatus.status === 'connected';
  const serverId = serverStatus.serverId;

  // Find all persons bound to this server
  const persons = listPersons({ includeArchived: false });
  for (const person of persons) {
    const bindings = listPersonBindings(person.id);
    const hasBoundBinding = bindings.some(b => b.serverId === serverId && b.enabled);
    if (!hasBoundBinding) continue;

    const prefs = getPersonMobilePreferences(person.id);
    if (!prefs.notifyNodeStatus) continue;

    const event = buildNodeStatusNotificationEvent(person.id, serverId, '', online);
    createPersonMobileNotification(event);
  }
}
