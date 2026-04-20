import { NativeModules, Platform } from 'react-native';

interface PmeowNotificationsModule {
  requestPermission(): Promise<boolean>;
  createDefaultChannel(): Promise<void>;
  showNotification(title: string, body: string, data?: Record<string, string>): Promise<void>;
  startGuardService(
    baseUrl: string,
    token: string,
    principalKind: 'admin' | 'person',
    adminAlertsEnabled: boolean,
    adminSecurityEnabled: boolean,
    taskEventsEnabled: boolean,
  ): Promise<boolean>;
  stopGuardService(): Promise<void>;
  isGuardServiceRunning(): Promise<boolean>;
  setAppInForeground(inForeground: boolean): Promise<void>;
  isIgnoringBatteryOptimizations(): Promise<boolean>;
  openBatteryOptimizationSettings(): Promise<boolean>;
}

const nativeModule: PmeowNotificationsModule | null = Platform.OS === 'android'
  ? (NativeModules.PmeowNotifications as PmeowNotificationsModule | undefined) ?? null
  : null;

let channelPrepared = false;

export function nativeNotificationsSupported(): boolean {
  return nativeModule != null;
}

export async function prepareNativeNotifications(): Promise<boolean> {
  if (!nativeModule) {
    return false;
  }

  const granted = await nativeModule.requestPermission();
  if (!granted) {
    return false;
  }

  if (!channelPrepared) {
    await nativeModule.createDefaultChannel();
    channelPrepared = true;
  }

  return true;
}

export async function showNativeNotification(input: {
  title: string;
  body: string;
  data?: Record<string, string>;
}): Promise<boolean> {
  if (!nativeModule) {
    return false;
  }

  const granted = await prepareNativeNotifications();
  if (!granted) {
    return false;
  }

  await nativeModule.showNotification(input.title, input.body, input.data);
  return true;
}

export async function startNativeGuardService(input: {
  baseUrl: string;
  token: string;
  principalKind: 'admin' | 'person';
  adminAlertsEnabled: boolean;
  adminSecurityEnabled: boolean;
  taskEventsEnabled: boolean;
}): Promise<boolean> {
  if (!nativeModule) {
    return false;
  }

  return nativeModule.startGuardService(
    input.baseUrl,
    input.token,
    input.principalKind,
    input.adminAlertsEnabled,
    input.adminSecurityEnabled,
    input.taskEventsEnabled,
  );
}

export async function stopNativeGuardService(): Promise<void> {
  if (!nativeModule) {
    return;
  }

  await nativeModule.stopGuardService();
}

export async function isNativeGuardServiceRunning(): Promise<boolean> {
  if (!nativeModule) {
    return false;
  }

  return nativeModule.isGuardServiceRunning();
}

export async function setNativeAppInForeground(inForeground: boolean): Promise<void> {
  if (!nativeModule) {
    return;
  }

  await nativeModule.setAppInForeground(inForeground);
}

export async function isIgnoringBatteryOptimizations(): Promise<boolean | null> {
  if (!nativeModule) {
    return null;
  }

  return nativeModule.isIgnoringBatteryOptimizations();
}

export async function openNativeBatteryOptimizationSettings(): Promise<boolean> {
  if (!nativeModule) {
    return false;
  }

  return nativeModule.openBatteryOptimizationSettings();
}