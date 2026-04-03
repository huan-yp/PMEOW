import type { MobileAdminSummary } from '@monitor/core';

async function adminFetch<T>(url: string): Promise<T> {
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await window.fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getAdminMobileSummary(): Promise<MobileAdminSummary> {
  return adminFetch('/api/mobile/admin/summary');
}

export async function getAdminMobileTasks(): Promise<any[]> {
  return adminFetch('/api/mobile/admin/tasks');
}

export async function getAdminMobileServers(): Promise<any[]> {
  return adminFetch('/api/mobile/admin/servers');
}

export async function getAdminMobileNotifications(): Promise<any[]> {
  return adminFetch('/api/mobile/admin/notifications');
}
