import { getPersonToken } from '../session/person-session.js';
import type { MobilePersonBootstrap, PersonMobilePreferenceRecord, PersonMobileNotificationRecord, MirroredAgentTaskRecord } from '@monitor/core';

async function personFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const token = getPersonToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> ?? {}),
  };
  if (token) headers['X-PMEOW-Person-Token'] = token;

  const res = await window.fetch(url, { ...options, headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getPersonBootstrap(): Promise<MobilePersonBootstrap> {
  return personFetch('/api/mobile/me/bootstrap');
}

export async function getPersonMobileTasks(hours = 168): Promise<MirroredAgentTaskRecord[]> {
  return personFetch(`/api/mobile/me/tasks?hours=${hours}`);
}

export async function cancelPersonTask(taskId: string): Promise<{ success: boolean }> {
  return personFetch(`/api/mobile/me/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' });
}

export async function getPersonMobileServers(): Promise<any[]> {
  return personFetch('/api/mobile/me/servers');
}

export async function getPersonMobileNotifications(limit = 50, offset = 0): Promise<PersonMobileNotificationRecord[]> {
  return personFetch(`/api/mobile/me/notifications?limit=${limit}&offset=${offset}`);
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await personFetch(`/api/mobile/me/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'POST' });
}

export async function getPersonMobilePreferences(): Promise<PersonMobilePreferenceRecord> {
  return personFetch('/api/mobile/me/preferences');
}

export async function updatePersonMobilePreferences(
  updates: Partial<Omit<PersonMobilePreferenceRecord, 'personId' | 'updatedAt'>>,
): Promise<PersonMobilePreferenceRecord> {
  return personFetch('/api/mobile/me/preferences', {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}
