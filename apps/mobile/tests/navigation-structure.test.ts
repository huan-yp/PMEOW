import { describe, expect, it } from 'vitest';
import {
  ADMIN_DETAIL_ROUTES,
  ADMIN_ALERT_SECONDARY_PAGES,
  ADMIN_SETTINGS_SECONDARY_PAGES,
  ADMIN_TAB_ROUTES,
  SERVER_DETAIL_SECONDARY_PAGES,
  getServerDetailSecondaryPageBlocks,
  MOBILE_INFORMATION_MAP,
  PERSON_DETAIL_ROUTES,
  PERSON_TAB_ROUTES,
} from '../src/app/navigation';

describe('mobile role navigation structure', () => {
  it('keeps ops/admin and person tabs role-specific', () => {
    expect(ADMIN_TAB_ROUTES.map((route) => route.name)).toEqual([
      'OpsOverview',
      'Nodes',
      'Alerts',
      'AdminSettings',
    ]);
    expect(PERSON_TAB_ROUTES.map((route) => route.name)).toEqual([
      'Resources',
      'MyTasks',
      'PersonSettings',
    ]);
  });

  it('models detail screens as stack routes instead of tab substates', () => {
    expect(ADMIN_DETAIL_ROUTES.map((route) => route.name)).toEqual([
      'AdminServerDetail',
      'AdminAlertDetail',
      'AdminSecurityEventDetail',
    ]);
    expect(PERSON_DETAIL_ROUTES.map((route) => route.name)).toEqual([
      'PersonServerDetail',
      'PersonTaskDetail',
    ]);
  });

  it('defines secondary pages for admin alert and settings sections', () => {
    expect(ADMIN_ALERT_SECONDARY_PAGES.map((page) => page.id)).toEqual([
      'activeAlerts',
      'securityEvents',
    ]);
    expect(ADMIN_SETTINGS_SECONDARY_PAGES.map((page) => page.id)).toEqual([
      'localNotifications',
      'notificationInbox',
      'connection',
    ]);
  });

  it('keeps server detail secondary tabs in one swipeable row', () => {
    expect(SERVER_DETAIL_SECONDARY_PAGES.map((page) => page.id)).toEqual([
      'overview',
      'realtime',
      'disk',
      'vram',
      'tasks',
    ]);
  });

  it('groups server detail tabs into swipeable three-title blocks', () => {
    expect(getServerDetailSecondaryPageBlocks().map((block) => block.map((page) => page.id))).toEqual([
      ['overview', 'realtime', 'disk'],
      ['vram', 'tasks'],
    ]);
  });
});

describe('mobile information parity map', () => {
  it('maps every existing admin information group to a new screen', () => {
    expect(MOBILE_INFORMATION_MAP.admin).toMatchObject({
      overviewCounts: 'OpsOverview',
      realtimeConnectionState: 'OpsOverview',
      machineSummary: 'Nodes',
      gpuIdleMachineView: 'Nodes',
      recentTaskEvents: 'OpsOverview',
      activeAlerts: 'Alerts',
      unresolvedSecurityEvents: 'Alerts',
      activeAlertDetail: 'AdminAlertDetail',
      securityEventDetail: 'AdminSecurityEventDetail',
      notificationSettings: 'AdminSettings',
      adminNotificationCategories: 'AdminSettings',
      hiddenHomeServers: 'AdminSettings',
      notificationInbox: 'AdminSettings',
      currentBackendAndSignOut: 'AdminSettings',
      serverDetailAllPanels: 'AdminServerDetail',
    });
  });

  it('maps every existing person information group to a new screen', () => {
    expect(MOBILE_INFORMATION_MAP.person).toMatchObject({
      machineSummary: 'Resources',
      gpuIdleMachineView: 'Resources',
      recentTaskEvents: 'Resources',
      notificationInbox: 'Resources',
      personTasks: 'MyTasks',
      cancelTask: 'MyTasks',
      notificationSettings: 'PersonSettings',
      personTaskNotifications: 'PersonSettings',
      idleServerSubscriptions: 'PersonSettings',
      currentBackendAndSignOut: 'PersonSettings',
      serverDetailAllPanels: 'PersonServerDetail',
      taskDetailAllFields: 'PersonTaskDetail',
    });
  });
});
