import { NativeModules, Platform } from 'react-native';

interface PmeowNotificationsModule {
  requestPermission(): Promise<boolean>;
  createDefaultChannel(): Promise<void>;
  showNotification(title: string, body: string, data?: Record<string, string>): Promise<void>;
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