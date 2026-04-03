export interface MobileNotificationBridge {
  getPermission(): Promise<'granted' | 'denied' | 'default'>;
  requestPermission(): Promise<'granted' | 'denied'>;
}

export class WebNotificationBridge implements MobileNotificationBridge {
  async getPermission(): Promise<'granted' | 'denied' | 'default'> {
    if (!('Notification' in window)) return 'denied';
    return Notification.permission;
  }

  async requestPermission(): Promise<'granted' | 'denied'> {
    if (!('Notification' in window)) return 'denied';
    const result = await Notification.requestPermission();
    return result === 'granted' ? 'granted' : 'denied';
  }
}
