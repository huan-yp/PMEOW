import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, BackHandler, Platform, SafeAreaView, StatusBar, Text, ToastAndroid, View } from 'react-native';
import {
  ADMIN_TABS,
  PERSON_TABS,
  isPersonTaskDetailVisible,
  normalizeSelectedTaskIdForTab,
  type AdminTab,
  type PersonTab,
} from './app/constants';
import { useServerGpuHistory } from './app/useServerGpuHistory';
import { styles } from './app/styles';
import { AuthenticatedShell, BottomTabs, SwipeTabView } from './components/common';
import { setNativeAppInForeground } from './lib/native-notifications';
import type { MobileHomeView } from './lib/preferences';
import { AdminAlertsScreen, AdminDashboardScreen } from './screens/AdminScreens';
import { ConnectionScreen } from './screens/ConnectionScreen';
import { PersonHomeScreen, PersonTasksScreen } from './screens/PersonScreens';
import { PersonTaskDetailScreen } from './screens/PersonTaskDetailScreen';
import { ServerDetailScreen } from './screens/ServerDetailScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { useAppStore } from './store/useAppStore';

export default function App() {
  const hydrated = useAppStore((state) => state.hydrated);
  const busy = useAppStore((state) => state.busy);
  const refreshing = useAppStore((state) => state.refreshing);
  const error = useAppStore((state) => state.error);
  const pendingTaskId = useAppStore((state) => state.pendingTaskId);
  const notificationPermissionGranted = useAppStore((state) => state.notificationPermissionGranted);
  const guardServiceRunning = useAppStore((state) => state.guardServiceRunning);
  const batteryOptimizationIgnored = useAppStore((state) => state.batteryOptimizationIgnored);
  const batteryOptimizationPromptShown = useAppStore((state) => state.batteryOptimizationPromptShown);
  const baseUrl = useAppStore((state) => state.baseUrl);
  const authToken = useAppStore((state) => state.authToken);
  const mode = useAppStore((state) => state.mode);
  const session = useAppStore((state) => state.session);
  const servers = useAppStore((state) => state.servers);
  const statuses = useAppStore((state) => state.statuses);
  const latestMetrics = useAppStore((state) => state.latestMetrics);
  const alerts = useAppStore((state) => state.alerts);
  const securityEvents = useAppStore((state) => state.securityEvents);
  const personTasks = useAppStore((state) => state.personTasks);
  const realtimeConnected = useAppStore((state) => state.realtimeConnected);
  const recentTaskEvents = useAppStore((state) => state.recentTaskEvents);
  const notificationSettings = useAppStore((state) => state.notificationSettings);
  const notificationInbox = useAppStore((state) => state.notificationInbox);
  const hydrate = useAppStore((state) => state.hydrate);
  const setBaseUrl = useAppStore((state) => state.setBaseUrl);
  const setMode = useAppStore((state) => state.setMode);
  const signIn = useAppStore((state) => state.signIn);
  const refreshOverview = useAppStore((state) => state.refreshOverview);
  const signOut = useAppStore((state) => state.signOut);
  const cancelTask = useAppStore((state) => state.cancelTask);
  const toggleNotificationsEnabled = useAppStore((state) => state.toggleNotificationsEnabled);
  const toggleAdminCategory = useAppStore((state) => state.toggleAdminCategory);
  const togglePersonTaskNotifications = useAppStore((state) => state.togglePersonTaskNotifications);
  const toggleIdleServerSubscription = useAppStore((state) => state.toggleIdleServerSubscription);
  const updateIdleServerRule = useAppStore((state) => state.updateIdleServerRule);
  const setHomeView = useAppStore((state) => state.setHomeView);
  const toggleAdminHiddenServer = useAppStore((state) => state.toggleAdminHiddenServer);
  const resumeRealtimeFromForeground = useAppStore((state) => state.resumeRealtimeFromForeground);
  const refreshAndroidBackgroundState = useAppStore((state) => state.refreshAndroidBackgroundState);
  const openBatteryOptimizationSettings = useAppStore((state) => state.openBatteryOptimizationSettings);
  const markBatteryOptimizationPromptShown = useAppStore((state) => state.markBatteryOptimizationPromptShown);
  const clearError = useAppStore((state) => state.clearError);

  const [adminTab, setAdminTab] = useState<AdminTab>('dashboard');
  const [personTab, setPersonTab] = useState<PersonTab>('home');
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskDetailRefreshNonce, setTaskDetailRefreshNonce] = useState(0);
  const foregroundResumeInFlightRef = useRef(false);
  const lastBackPressAtRef = useRef(0);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    void setNativeAppInForeground(true);
    const subscription = AppState.addEventListener('change', (nextState) => {
      const active = nextState === 'active';
      void setNativeAppInForeground(active);
      if (active) {
        void (async () => {
          await refreshAndroidBackgroundState();
          if (!session.authenticated || !authToken || !baseUrl || foregroundResumeInFlightRef.current) {
            return;
          }

          foregroundResumeInFlightRef.current = true;
          try {
            await resumeRealtimeFromForeground();
          } finally {
            foregroundResumeInFlightRef.current = false;
          }
        })();
      }
    });

    return () => {
      subscription.remove();
      void setNativeAppInForeground(false);
    };
  }, [authToken, baseUrl, refreshAndroidBackgroundState, resumeRealtimeFromForeground, session.authenticated]);

  useEffect(() => {
    setSelectedServerId(null);
    setSelectedTaskId(null);
    if (session.principal?.kind === 'admin') {
      setAdminTab('dashboard');
    }
    if (session.principal?.kind === 'person') {
      setPersonTab('home');
    }
  }, [session.principal?.kind]);

  useEffect(() => {
    if (
      !session.authenticated
      || !notificationSettings.notificationsEnabled
      || !guardServiceRunning
      || batteryOptimizationIgnored !== false
      || batteryOptimizationPromptShown
    ) {
      return;
    }

    markBatteryOptimizationPromptShown();
    Alert.alert(
      '建议关闭电池优化',
      '为了提升最小化后的通知可靠性，建议为 PMEOW 关闭系统电池优化。',
      [
        { text: '稍后处理', style: 'cancel' },
        {
          text: '去设置',
          onPress: () => {
            void openBatteryOptimizationSettings();
          },
        },
      ],
    );
  }, [
    batteryOptimizationIgnored,
    batteryOptimizationPromptShown,
    guardServiceRunning,
    markBatteryOptimizationPromptShown,
    notificationSettings.notificationsEnabled,
    openBatteryOptimizationSettings,
    session.authenticated,
  ]);

  const selectedServer = useMemo(
    () => servers.find((server) => server.id === selectedServerId) ?? null,
    [selectedServerId, servers],
  );
  const selectedReport = selectedServerId ? latestMetrics[selectedServerId] : undefined;
  const { gpuRealtimeHistory, hostRealtimeHistory, realtimeHistoryLoading } = useServerGpuHistory(
    selectedServerId,
    selectedReport,
    baseUrl,
    authToken,
  );

  const onlineCount = useMemo(
    () => servers.filter((server) => statuses[server.id]?.status === 'online').length,
    [servers, statuses],
  );

  const personName = session.principal?.kind === 'person'
    ? session.person?.displayName ?? '普通用户'
    : '管理员';

  const isAdmin = session.authenticated && session.principal.kind === 'admin';
  const personNotificationServers = useMemo(
    () => servers.filter((server) => (latestMetrics[server.id]?.resourceSnapshot.gpuCards.length ?? 0) > 0),
    [latestMetrics, servers],
  );
  const adminHomeView = notificationSettings.home.adminView;
  const personHomeView = notificationSettings.home.personView;
  const adminHiddenServerIds = notificationSettings.home.adminHiddenServerIds;
  const adminHomeServers = useMemo(
    () => servers.filter((server) => !adminHiddenServerIds.includes(server.id)),
    [adminHiddenServerIds, servers],
  );

  const handleHomeViewChange = (role: 'admin' | 'person') => (view: MobileHomeView) => {
    setHomeView(role, view);
  };

  const taskDetailVisible = isPersonTaskDetailVisible(personTab, selectedTaskId);

  const handleRefreshPersonShell = async () => {
    await refreshOverview();
    if (taskDetailVisible) {
      setTaskDetailRefreshNonce((current) => current + 1);
    }
  };

  useEffect(() => {
    if (Platform.OS !== 'android' || !session.authenticated) {
      return;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selectedServerId) {
        setSelectedServerId(null);
        return true;
      }

      if (taskDetailVisible) {
        setSelectedTaskId(null);
        return true;
      }

      if (isAdmin && adminTab !== 'dashboard') {
        setAdminTab('dashboard');
        return true;
      }

      if (!isAdmin && personTab !== 'home') {
        setPersonTab('home');
        setSelectedTaskId((current) => normalizeSelectedTaskIdForTab('home', current));
        return true;
      }

      const now = Date.now();
      if (now - lastBackPressAtRef.current < 2000) {
        BackHandler.exitApp();
        return true;
      }

      lastBackPressAtRef.current = now;
      ToastAndroid.show('再按一次退出', ToastAndroid.SHORT);
      return true;
    });

    return () => {
      subscription.remove();
    };
  }, [adminTab, isAdmin, personTab, selectedServerId, session.authenticated, taskDetailVisible]);

  const handleChangePersonTab = (tab: PersonTab) => {
    setPersonTab(tab);
    setSelectedTaskId((current) => normalizeSelectedTaskIdForTab(tab, current));
  };

  if (!hydrated) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" />
        <View style={styles.loadingWrap}>
          <ActivityIndicator color="#86d5ff" size="large" />
          <Text style={styles.loadingText}>正在恢复移动端会话...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!session.authenticated) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" />
        <ConnectionScreen
          busy={busy}
          error={error}
          baseUrl={baseUrl}
          mode={mode}
          onChangeBaseUrl={setBaseUrl}
          onChangeMode={setMode}
          onSubmit={async (secret) => {
            await signIn({ secret });
          }}
          onClearError={clearError}
        />
      </SafeAreaView>
    );
  }

  const subtitle = `${isAdmin ? '管理员' : personName} · ${baseUrl}`;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      {selectedServer ? (
        <AuthenticatedShell
          title={`${selectedServer.name} · 机器详情`}
          subtitle={subtitle}
          error={error}
          refreshing={refreshing}
          onRefresh={refreshOverview}
        >
          <ServerDetailScreen
            server={selectedServer}
            status={statuses[selectedServer.id]}
            report={selectedReport}
            hostRealtimeHistory={hostRealtimeHistory}
            gpuRealtimeHistory={gpuRealtimeHistory}
            realtimeHistoryLoading={realtimeHistoryLoading}
            isAdmin={isAdmin}
            subscribed={Boolean(notificationSettings.person.idleServerRules[selectedServer.id])}
            subscriptionRule={notificationSettings.person.idleServerRules[selectedServer.id] ?? null}
            onBack={() => setSelectedServerId(null)}
            onToggleSubscription={() => toggleIdleServerSubscription(selectedServer.id)}
            onSaveSubscriptionRule={(rule) => updateIdleServerRule(selectedServer.id, rule)}
          />
        </AuthenticatedShell>
      ) : isAdmin ? (
        <AuthenticatedShell
          title="管理员值班台"
          subtitle={subtitle}
          identityLabel={`管理员`}
          compact
          error={error}
          refreshing={refreshing}
          onRefresh={refreshOverview}
          tabs={<BottomTabs tabs={ADMIN_TABS} activeTab={adminTab} onChangeTab={setAdminTab} />}
        >
          <SwipeTabView
            tabs={ADMIN_TABS}
            activeTab={adminTab}
            onChangeTab={setAdminTab}
            renderScene={(tab) => {
              if (tab === 'dashboard') {
                return (
                  <AdminDashboardScreen
                    realtimeConnected={realtimeConnected}
                    serverCount={servers.length}
                    onlineCount={onlineCount}
                    alertCount={alerts.length}
                    securityCount={securityEvents.length}
                    servers={adminHomeServers}
                    statuses={statuses}
                    latestMetrics={latestMetrics}
                    recentTaskEvents={recentTaskEvents}
                    homeView={adminHomeView}
                    onChangeHomeView={handleHomeViewChange('admin')}
                    onSelectServer={setSelectedServerId}
                  />
                );
              }
              if (tab === 'alerts') {
                return <AdminAlertsScreen alerts={alerts} securityEvents={securityEvents} />;
              }
              return (
                <SettingsScreen
                  baseUrl={baseUrl}
                  isAdmin
                  notificationsEnabled={notificationSettings.notificationsEnabled}
                  notificationPermissionGranted={notificationPermissionGranted}
                  guardServiceRunning={guardServiceRunning}
                  batteryOptimizationIgnored={batteryOptimizationIgnored}
                  adminCategorySettings={notificationSettings.adminCategories}
                  personTaskNotificationsEnabled={notificationSettings.person.taskEvents}
                  idleServerIds={Object.keys(notificationSettings.person.idleServerRules)}
                  adminHiddenServerIds={adminHiddenServerIds}
                  servers={servers}
                  notificationInbox={notificationInbox}
                  onOpenBatteryOptimizationSettings={() => {
                    void openBatteryOptimizationSettings();
                  }}
                  onToggleNotificationsEnabled={toggleNotificationsEnabled}
                  onToggleAdminCategory={toggleAdminCategory}
                  onTogglePersonTaskNotifications={togglePersonTaskNotifications}
                  onToggleIdleServerSubscription={toggleIdleServerSubscription}
                  onToggleAdminHiddenServer={toggleAdminHiddenServer}
                  onSignOut={signOut}
                />
              );
            }}
          />
        </AuthenticatedShell>
      ) : (
        <AuthenticatedShell
          title={taskDetailVisible ? '任务详情' : '普通用户移动端'}
          subtitle={subtitle}
          identityLabel={`普通用户: ${personName}`}
          compact
          error={error}
          refreshing={refreshing}
          onRefresh={handleRefreshPersonShell}
          tabs={<BottomTabs tabs={PERSON_TABS} activeTab={personTab} onChangeTab={handleChangePersonTab} />}
        >
          {taskDetailVisible && selectedTaskId ? (
            <PersonTaskDetailScreen
              taskId={selectedTaskId}
              baseUrl={baseUrl}
              authToken={authToken}
              refreshNonce={taskDetailRefreshNonce}
              onBack={() => setSelectedTaskId(null)}
              onRefreshOverview={refreshOverview}
            />
          ) : (
            <SwipeTabView
              tabs={PERSON_TABS}
              activeTab={personTab}
              onChangeTab={handleChangePersonTab}
              renderScene={(tab) => {
                if (tab === 'home') {
                  return (
                    <PersonHomeScreen
                      personName={personName}
                      servers={servers}
                      statuses={statuses}
                      latestMetrics={latestMetrics}
                      personTasks={personTasks}
                      recentTaskEvents={recentTaskEvents}
                      notificationInbox={notificationInbox}
                      homeView={personHomeView}
                      onChangeHomeView={handleHomeViewChange('person')}
                      onSelectServer={(serverId) => {
                        setSelectedTaskId(null);
                        setSelectedServerId(serverId);
                      }}
                    />
                  );
                }
                if (tab === 'tasks') {
                  return (
                    <PersonTasksScreen
                      personTasks={personTasks}
                      pendingTaskId={pendingTaskId}
                      onSelectTask={(task) => {
                        setSelectedServerId(null);
                        setSelectedTaskId(task.id);
                      }}
                      onCancelTask={cancelTask}
                    />
                  );
                }
                return (
                  <SettingsScreen
                    baseUrl={baseUrl}
                    isAdmin={false}
                    notificationsEnabled={notificationSettings.notificationsEnabled}
                    notificationPermissionGranted={notificationPermissionGranted}
                    guardServiceRunning={guardServiceRunning}
                    batteryOptimizationIgnored={batteryOptimizationIgnored}
                    adminCategorySettings={notificationSettings.adminCategories}
                    personTaskNotificationsEnabled={notificationSettings.person.taskEvents}
                    idleServerIds={Object.keys(notificationSettings.person.idleServerRules)}
                    adminHiddenServerIds={adminHiddenServerIds}
                    servers={personNotificationServers}
                    notificationInbox={notificationInbox}
                    onOpenBatteryOptimizationSettings={() => {
                      void openBatteryOptimizationSettings();
                    }}
                    onToggleNotificationsEnabled={toggleNotificationsEnabled}
                    onToggleAdminCategory={toggleAdminCategory}
                    onTogglePersonTaskNotifications={togglePersonTaskNotifications}
                    onToggleIdleServerSubscription={toggleIdleServerSubscription}
                    onToggleAdminHiddenServer={toggleAdminHiddenServer}
                    onSignOut={signOut}
                  />
                );
              }}
            />
          )}
        </AuthenticatedShell>
      )}
    </SafeAreaView>
  );
}
