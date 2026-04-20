import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, AppState, SafeAreaView, StatusBar, Text, View } from 'react-native';
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
import { AuthenticatedShell, BottomTabs } from './components/common';
import { setNativeAppInForeground } from './lib/native-notifications';
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
  const refreshAndroidBackgroundState = useAppStore((state) => state.refreshAndroidBackgroundState);
  const openBatteryOptimizationSettings = useAppStore((state) => state.openBatteryOptimizationSettings);
  const markBatteryOptimizationPromptShown = useAppStore((state) => state.markBatteryOptimizationPromptShown);
  const clearError = useAppStore((state) => state.clearError);

  const [adminTab, setAdminTab] = useState<AdminTab>('dashboard');
  const [personTab, setPersonTab] = useState<PersonTab>('home');
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskDetailRefreshNonce, setTaskDetailRefreshNonce] = useState(0);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    void setNativeAppInForeground(true);
    const subscription = AppState.addEventListener('change', (nextState) => {
      const active = nextState === 'active';
      void setNativeAppInForeground(active);
      if (active) {
        void refreshAndroidBackgroundState();
      }
    });

    return () => {
      subscription.remove();
      void setNativeAppInForeground(false);
    };
  }, [refreshAndroidBackgroundState]);

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
  const taskDetailVisible = isPersonTaskDetailVisible(personTab, selectedTaskId);

  const handleRefreshPersonShell = async () => {
    await refreshOverview();
    if (taskDetailVisible) {
      setTaskDetailRefreshNonce((current) => current + 1);
    }
  };

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
          error={error}
          refreshing={refreshing}
          onRefresh={refreshOverview}
          tabs={<BottomTabs tabs={ADMIN_TABS} activeTab={adminTab} onChangeTab={setAdminTab} />}
        >
          {adminTab === 'dashboard' ? (
            <AdminDashboardScreen
              realtimeConnected={realtimeConnected}
              serverCount={servers.length}
              onlineCount={onlineCount}
              alertCount={alerts.length}
              securityCount={securityEvents.length}
              servers={servers}
              statuses={statuses}
              latestMetrics={latestMetrics}
              recentTaskEvents={recentTaskEvents}
              onSelectServer={setSelectedServerId}
            />
          ) : adminTab === 'alerts' ? (
            <AdminAlertsScreen alerts={alerts} securityEvents={securityEvents} />
          ) : (
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
              servers={servers}
              notificationInbox={notificationInbox}
              onOpenBatteryOptimizationSettings={() => {
                void openBatteryOptimizationSettings();
              }}
              onToggleNotificationsEnabled={toggleNotificationsEnabled}
              onToggleAdminCategory={toggleAdminCategory}
              onTogglePersonTaskNotifications={togglePersonTaskNotifications}
              onToggleIdleServerSubscription={toggleIdleServerSubscription}
              onSignOut={signOut}
            />
          )}
        </AuthenticatedShell>
      ) : (
        <AuthenticatedShell
          title={taskDetailVisible ? '任务详情' : '普通用户移动端'}
          subtitle={subtitle}
          error={error}
          refreshing={refreshing}
          onRefresh={handleRefreshPersonShell}
          tabs={<BottomTabs tabs={PERSON_TABS} activeTab={personTab} onChangeTab={handleChangePersonTab} />}
        >
          {personTab === 'home' ? (
            <PersonHomeScreen
              personName={personName}
              servers={servers}
              statuses={statuses}
              latestMetrics={latestMetrics}
              personTasks={personTasks}
              recentTaskEvents={recentTaskEvents}
              notificationInbox={notificationInbox}
              onSelectServer={(serverId) => {
                setSelectedTaskId(null);
                setSelectedServerId(serverId);
              }}
            />
          ) : personTab === 'tasks' ? (
            taskDetailVisible && selectedTaskId ? (
              <PersonTaskDetailScreen
                taskId={selectedTaskId}
                baseUrl={baseUrl}
                authToken={authToken}
                refreshNonce={taskDetailRefreshNonce}
                onBack={() => setSelectedTaskId(null)}
                onRefreshOverview={refreshOverview}
              />
            ) : (
              <PersonTasksScreen
                personTasks={personTasks}
                pendingTaskId={pendingTaskId}
                onSelectTask={(task) => {
                  setSelectedServerId(null);
                  setSelectedTaskId(task.id);
                }}
                onCancelTask={cancelTask}
              />
            )
          ) : (
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
              servers={personNotificationServers}
              notificationInbox={notificationInbox}
              onOpenBatteryOptimizationSettings={() => {
                void openBatteryOptimizationSettings();
              }}
              onToggleNotificationsEnabled={toggleNotificationsEnabled}
              onToggleAdminCategory={toggleAdminCategory}
              onTogglePersonTaskNotifications={togglePersonTaskNotifications}
              onToggleIdleServerSubscription={toggleIdleServerSubscription}
              onSignOut={signOut}
            />
          )}
        </AuthenticatedShell>
      )}
    </SafeAreaView>
  );
}
