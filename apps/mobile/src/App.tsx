import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StatusBar, Text, View } from 'react-native';
import { ADMIN_TABS, PERSON_TABS, type AdminTab, type PersonTab } from './app/constants';
import { styles } from './app/styles';
import { AuthenticatedShell, BottomTabs } from './components/common';
import { AdminAlertsScreen, AdminDashboardScreen } from './screens/AdminScreens';
import { ConnectionScreen } from './screens/ConnectionScreen';
import { PersonHomeScreen, PersonTasksScreen } from './screens/PersonScreens';
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
  const baseUrl = useAppStore((state) => state.baseUrl);
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
  const clearError = useAppStore((state) => state.clearError);

  const [adminTab, setAdminTab] = useState<AdminTab>('dashboard');
  const [personTab, setPersonTab] = useState<PersonTab>('home');
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    setSelectedServerId(null);
    if (session.principal?.kind === 'admin') {
      setAdminTab('dashboard');
    }
    if (session.principal?.kind === 'person') {
      setPersonTab('home');
    }
  }, [session.principal?.kind]);

  const selectedServer = useMemo(
    () => servers.find((server) => server.id === selectedServerId) ?? null,
    [selectedServerId, servers],
  );

  const onlineCount = useMemo(
    () => servers.filter((server) => statuses[server.id]?.status === 'online').length,
    [servers, statuses],
  );

  const personName = session.principal?.kind === 'person'
    ? session.person?.displayName ?? '普通用户'
    : '管理员';

  const isAdmin = session.authenticated && session.principal.kind === 'admin';

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
            report={latestMetrics[selectedServer.id]}
            isAdmin={isAdmin}
            subscribed={notificationSettings.person.idleServerIds.includes(selectedServer.id)}
            onBack={() => setSelectedServerId(null)}
            onToggleSubscription={() => toggleIdleServerSubscription(selectedServer.id)}
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
              adminCategorySettings={notificationSettings.adminCategories}
              personTaskNotificationsEnabled={notificationSettings.person.taskEvents}
              idleServerIds={notificationSettings.person.idleServerIds}
              servers={servers}
              notificationInbox={notificationInbox}
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
          title="普通用户移动端"
          subtitle={subtitle}
          error={error}
          refreshing={refreshing}
          onRefresh={refreshOverview}
          tabs={<BottomTabs tabs={PERSON_TABS} activeTab={personTab} onChangeTab={setPersonTab} />}
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
              onSelectServer={setSelectedServerId}
            />
          ) : personTab === 'tasks' ? (
            <PersonTasksScreen
              personTasks={personTasks}
              pendingTaskId={pendingTaskId}
              onCancelTask={cancelTask}
            />
          ) : (
            <SettingsScreen
              baseUrl={baseUrl}
              isAdmin={false}
              notificationsEnabled={notificationSettings.notificationsEnabled}
              notificationPermissionGranted={notificationPermissionGranted}
              adminCategorySettings={notificationSettings.adminCategories}
              personTaskNotificationsEnabled={notificationSettings.person.taskEvents}
              idleServerIds={notificationSettings.person.idleServerIds}
              servers={servers}
              notificationInbox={notificationInbox}
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
