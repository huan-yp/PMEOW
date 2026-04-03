import { describe, expect, it } from 'vitest';
import { createPerson } from '../../src/db/persons.js';
import {
  createPersonMobileNotification,
  getPersonMobileNotifications,
  getPersonUnreadNotificationCount,
  markPersonNotificationRead,
} from '../../src/db/person-mobile-notifications.js';
import {
  buildTaskNotificationEvent,
  buildNodeStatusNotificationEvent,
  buildGpuAvailabilityNotificationEvent,
  shouldNotifyForTask,
} from '../../src/mobile/notification-policies.js';
import { getPersonMobilePreferences, updatePersonMobilePreferences } from '../../src/db/person-mobile-preferences.js';

describe('person mobile notifications', () => {
  it('creates and retrieves notification feed items', () => {
    const person = createPerson({ displayName: 'Alice', customFields: {} });

    const event = buildTaskNotificationEvent(person.id, 'task-1', 'server-1', 'running', 'python train.py');
    expect(event).not.toBeNull();
    const notification = createPersonMobileNotification(event!);
    expect(notification).not.toBeNull();
    expect(notification!.personId).toBe(person.id);
    expect(notification!.category).toBe('task');
    expect(notification!.eventType).toBe('task_started');

    const feed = getPersonMobileNotifications(person.id);
    expect(feed).toHaveLength(1);
    expect(feed[0].title).toBe('任务开始运行');
  });

  it('dedupes notifications with the same dedupeKey', () => {
    const person = createPerson({ displayName: 'Bob', customFields: {} });

    const event = buildTaskNotificationEvent(person.id, 'task-2', 'server-1', 'completed')!;
    createPersonMobileNotification(event);
    const duplicate = createPersonMobileNotification(event);
    expect(duplicate).toBeNull();

    expect(getPersonMobileNotifications(person.id)).toHaveLength(1);
  });

  it('tracks unread counts and read-state transitions', () => {
    const person = createPerson({ displayName: 'Carol', customFields: {} });

    const n1 = createPersonMobileNotification(
      buildTaskNotificationEvent(person.id, 'task-3', 'server-1', 'failed')!,
    )!;
    createPersonMobileNotification(
      buildNodeStatusNotificationEvent(person.id, 'server-1', 'GPU-1', false),
    );

    expect(getPersonUnreadNotificationCount(person.id)).toBe(2);

    markPersonNotificationRead(n1.id);
    expect(getPersonUnreadNotificationCount(person.id)).toBe(1);
  });

  it('builds node status notification events', () => {
    const offline = buildNodeStatusNotificationEvent('p1', 'server-1', 'GPU-1', false);
    expect(offline.eventType).toBe('node_offline');
    expect(offline.category).toBe('node');

    const online = buildNodeStatusNotificationEvent('p1', 'server-1', 'GPU-1', true);
    expect(online.eventType).toBe('node_online');
  });

  it('builds GPU availability notification events', () => {
    const event = buildGpuAvailabilityNotificationEvent('p1', 'server-1', 'GPU-1', 2, 20);
    expect(event.category).toBe('gpu');
    expect(event.eventType).toBe('gpu_available');
    expect(event.body).toContain('2 GPU(s)');
  });

  it('respects preference flags for task notifications', () => {
    const person = createPerson({ displayName: 'Dave', customFields: {} });
    const prefs = getPersonMobilePreferences(person.id);

    expect(shouldNotifyForTask(prefs, 'running')).toBe(true);
    expect(shouldNotifyForTask(prefs, 'completed')).toBe(true);
    expect(shouldNotifyForTask(prefs, 'failed')).toBe(true);
    expect(shouldNotifyForTask(prefs, 'cancelled')).toBe(true);

    const updated = updatePersonMobilePreferences(person.id, { notifyTaskStarted: false });
    expect(shouldNotifyForTask(updated, 'running')).toBe(false);
    expect(shouldNotifyForTask(updated, 'failed')).toBe(true);
  });

  it('GPU availability notifications are disabled by default', () => {
    const person = createPerson({ displayName: 'Eve', customFields: {} });
    const prefs = getPersonMobilePreferences(person.id);
    expect(prefs.notifyGpuAvailable).toBe(false);
  });

  it('does not create notification for queued task status', () => {
    const event = buildTaskNotificationEvent('p1', 'task-q', 'server-1', 'queued');
    expect(event).toBeNull();
  });
});
