import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_DETAIL_ROUTES,
  ADMIN_ALERT_SECONDARY_PAGES,
  ADMIN_SETTINGS_SECONDARY_PAGES,
  ADMIN_TAB_ROUTES,
  PERSON_NOTIFICATION_SECONDARY_PAGES,
  PERSON_SETTINGS_SECONDARY_PAGES,
  PERSON_TASK_SECONDARY_PAGES,
  SERVER_DETAIL_SECONDARY_PAGES,
  getServerDetailSecondaryPageBlocks,
  MOBILE_INFORMATION_MAP,
  PERSON_DETAIL_ROUTES,
  PERSON_TAB_ROUTES,
} from '../src/app/navigation';

const testDir = dirname(fileURLToPath(import.meta.url));
const mobileSrcDir = join(testDir, '..', 'src');

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
      'Notifications',
      'PersonSettings',
    ]);
  });

  it('provides an icon identity for every main tab', () => {
    expect(ADMIN_TAB_ROUTES.map((route) => route.icon)).toEqual([
      'overview',
      'nodes',
      'alerts',
      'settings',
    ]);
    expect(PERSON_TAB_ROUTES.map((route) => route.icon)).toEqual([
      'resources',
      'tasks',
      'notifications',
      'settings',
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

  it('defines secondary pages for person task and settings sections', () => {
    expect(PERSON_TASK_SECONDARY_PAGES.map((page) => page.id)).toEqual([
      'inProgress',
      'completed',
      'all',
    ]);
    expect(PERSON_NOTIFICATION_SECONDARY_PAGES.map((page) => page.id)).toEqual([
      'taskEvents',
      'notificationInbox',
    ]);
    expect(PERSON_SETTINGS_SECONDARY_PAGES.map((page) => page.id)).toEqual([
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

describe('mobile pull-to-refresh structure', () => {
  it('uses pull-to-refresh scroll containers on authenticated screens', () => {
    const screenFiles = [
      'screens/AdminScreens.tsx',
      'screens/PersonScreens.tsx',
      'screens/ServerDetailScreen.tsx',
      'screens/PersonTaskDetailScreen.tsx',
      'screens/SettingsScreen.tsx',
    ];

    for (const screenFile of screenFiles) {
      const source = readFileSync(join(mobileSrcDir, screenFile), 'utf8');
      expect(source, screenFile).toContain('RefreshableScrollView');
      expect(source, screenFile).not.toContain('<ScrollView contentContainerStyle={styles.screenContent}');
    }
  });

  it('removes manual refresh buttons from the authenticated shell', () => {
    const source = readFileSync(join(mobileSrcDir, 'components/common.tsx'), 'utf8');
    expect(source).not.toContain('compactRefreshButton');
    expect(source).not.toContain('refreshButton');
    expect(source).not.toContain('刷新中');
  });

  it('keeps authenticated fallback pages refreshable', () => {
    const source = readFileSync(join(mobileSrcDir, 'App.tsx'), 'utf8');
    expect(source.match(/<RefreshableScrollView contentContainerStyle=\{styles\.screenContent\}>/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
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
      recentTaskEvents: 'Notifications',
      notificationInbox: 'Notifications',
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
