import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, StatusBar, Text, View } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import {
  createBottomTabNavigator,
  type BottomTabBarProps,
  type BottomTabScreenProps,
} from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  createNativeStackNavigator,
  type NativeStackNavigationProp,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import type { Alert as PmeowAlert, SecurityEvent, Server } from '@pmeow/app-common';
import { ADMIN_TAB_ROUTES, PERSON_TAB_ROUTES } from './app/navigation';
import { styles } from './app/styles';
import { useServerGpuHistory } from './app/useServerGpuHistory';
import { AuthenticatedShell, SectionCard } from './components/common';
import { setNativeAppInForeground } from './lib/native-notifications';
import type { MobileHomeView } from './lib/preferences';
import {
  AdminAlertDetailView,
  AdminAlertsScreen,
  AdminNodesScreen,
  AdminOpsOverviewScreen,
  AdminSecurityEventDetailView,
} from './screens/AdminScreens';
import { ConnectionScreen } from './screens/ConnectionScreen';
import { PersonHomeScreen, PersonTasksScreen } from './screens/PersonScreens';
import { PersonTaskDetailScreen } from './screens/PersonTaskDetailScreen';
import { ServerDetailScreen } from './screens/ServerDetailScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import type { MobileAppState } from './store/types';
import { useAppStore } from './store/useAppStore';

type AdminTabParamList = {
  OpsOverview: undefined;
  Nodes: undefined;
  Alerts: undefined;
  AdminSettings: undefined;
};

type AdminStackParamList = {
  AdminTabs: undefined;
  AdminServerDetail: { serverId: string };
  AdminAlertDetail: { alertId: number };
  AdminSecurityEventDetail: { eventId: number };
};

type PersonTabParamList = {
  Resources: undefined;
  MyTasks: undefined;
  PersonSettings: undefined;
};

type PersonStackParamList = {
  PersonTabs: undefined;
  PersonServerDetail: { serverId: string };
  PersonTaskDetail: { taskId: string };
};

type MobileContextValue = MobileAppState & {
  taskDetailRefreshNonce: number;
  bumpTaskDetailRefreshNonce: () => void;
};

const AdminStack = createNativeStackNavigator<AdminStackParamList>();
const AdminTabs = createBottomTabNavigator<AdminTabParamList>();
const PersonStack = createNativeStackNavigator<PersonStackParamList>();
const PersonTabs = createBottomTabNavigator<PersonTabParamList>();

const MobileContext = createContext<MobileContextValue | null>(null);

const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#07121d',
    border: '#162637',
    card: '#0d1d2c',
    primary: '#4fbef7',
    text: '#f3f8fc',
  },
};

const tabScreenOptions = {
  headerShown: false,
  tabBarActiveTintColor: '#f3f8fc',
  tabBarInactiveTintColor: '#9db1c2',
  tabBarStyle: {
    backgroundColor: '#07121d',
    borderTopColor: '#162637',
  },
  tabBarLabelStyle: {
    fontSize: 12,
    fontWeight: '700' as const,
  },
};

function RoleTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.roleTabBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {state.routes.map((route, index) => {
        const descriptor = descriptors[route.key];
        const options = descriptor.options;
        const focused = state.index === index;
        const label = typeof options.tabBarLabel === 'string'
          ? options.tabBarLabel
          : typeof options.title === 'string'
            ? options.title
            : route.name;

        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            style={[styles.roleTabItem, focused ? styles.roleTabItemActive : null]}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });

              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            }}
          >
            <Text style={[styles.roleTabLabel, focused ? styles.roleTabLabelActive : null]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function useMobileContext(): MobileContextValue {
  const context = useContext(MobileContext);
  if (!context) {
    throw new Error('Mobile navigation context is not available');
  }
  return context;
}

function getPersonName(context: MobileContextValue): string {
  return context.session.principal?.kind === 'person'
    ? context.session.person?.displayName ?? '普通用户'
    : '管理员';
}

function getShellSubtitle(context: MobileContextValue, isAdmin: boolean): string {
  return `${isAdmin ? '管理员' : getPersonName(context)} · ${context.baseUrl}`;
}

function ScreenFrame(props: {
  title: string;
  identityLabel: string;
  onRefresh: () => Promise<void>;
  children: ReactNode;
}) {
  const context = useMobileContext();

  return (
    <AuthenticatedShell
      title={props.title}
      subtitle={getShellSubtitle(context, context.session.principal?.kind === 'admin')}
      identityLabel={props.identityLabel}
      compact
      error={context.error}
      refreshing={context.refreshing}
      onRefresh={props.onRefresh}
    >
      {props.children}
    </AuthenticatedShell>
  );
}

function MissingServerScreen(props: { onRefresh: () => Promise<void> }) {
  return (
    <ScreenFrame title="机器详情" identityLabel="机器详情" onRefresh={props.onRefresh}>
      <View style={styles.screenContent}>
        <SectionCard title="无法显示机器详情" description="该机器可能已不在当前可见范围内。">
          <Text style={styles.emptyText}>请返回列表刷新后重试。</Text>
        </SectionCard>
      </View>
    </ScreenFrame>
  );
}

function MissingAdminRecordScreen(props: {
  title: string;
  description: string;
  onRefresh: () => Promise<void>;
}) {
  return (
    <ScreenFrame title={props.title} identityLabel={props.title} onRefresh={props.onRefresh}>
      <View style={styles.screenContent}>
        <SectionCard title={props.title} description={props.description}>
          <Text style={styles.emptyText}>请返回列表刷新后重试。</Text>
        </SectionCard>
      </View>
    </ScreenFrame>
  );
}

function AdminOpsOverviewTab(props: BottomTabScreenProps<AdminTabParamList, 'OpsOverview'>) {
  const context = useMobileContext();
  const stackNavigation = props.navigation.getParent<NativeStackNavigationProp<AdminStackParamList>>();
  const onlineCount = useMemo(
    () => context.servers.filter((server) => context.statuses[server.id]?.status === 'online').length,
    [context.servers, context.statuses],
  );

  return (
    <ScreenFrame title="运维总览" identityLabel="管理员值班台" onRefresh={context.refreshOverview}>
      <AdminOpsOverviewScreen
        realtimeConnected={context.realtimeConnected}
        serverCount={context.servers.length}
        onlineCount={onlineCount}
        alertCount={context.alerts.length}
        securityCount={context.securityEvents.length}
        alerts={context.alerts}
        securityEvents={context.securityEvents}
        recentTaskEvents={context.recentTaskEvents}
        onSelectAlert={(alertId) => stackNavigation?.navigate('AdminAlertDetail', { alertId })}
        onSelectSecurityEvent={(eventId) => stackNavigation?.navigate('AdminSecurityEventDetail', { eventId })}
      />
    </ScreenFrame>
  );
}

function AdminNodesTab(props: BottomTabScreenProps<AdminTabParamList, 'Nodes'>) {
  const context = useMobileContext();
  const adminHiddenServerIds = context.notificationSettings.home.adminHiddenServerIds;
  const adminHomeServers = useMemo(
    () => context.servers.filter((server) => !adminHiddenServerIds.includes(server.id)),
    [adminHiddenServerIds, context.servers],
  );
  const stackNavigation = props.navigation.getParent<NativeStackNavigationProp<AdminStackParamList>>();

  return (
    <ScreenFrame title="节点" identityLabel="管理员值班台" onRefresh={context.refreshOverview}>
      <AdminNodesScreen
        servers={adminHomeServers}
        statuses={context.statuses}
        latestMetrics={context.latestMetrics}
        homeView={context.notificationSettings.home.adminView}
        onChangeHomeView={(view: MobileHomeView) => context.setHomeView('admin', view)}
        onSelectServer={(serverId) => stackNavigation?.navigate('AdminServerDetail', { serverId })}
      />
    </ScreenFrame>
  );
}

function AdminAlertsTab(props: BottomTabScreenProps<AdminTabParamList, 'Alerts'>) {
  const context = useMobileContext();
  const stackNavigation = props.navigation.getParent<NativeStackNavigationProp<AdminStackParamList>>();

  return (
    <ScreenFrame title="告警" identityLabel="管理员值班台" onRefresh={context.refreshOverview}>
      <AdminAlertsScreen
        alerts={context.alerts}
        securityEvents={context.securityEvents}
        onSelectAlert={(alertId) => stackNavigation?.navigate('AdminAlertDetail', { alertId })}
        onSelectSecurityEvent={(eventId) => stackNavigation?.navigate('AdminSecurityEventDetail', { eventId })}
      />
    </ScreenFrame>
  );
}

function AdminSettingsTab() {
  const context = useMobileContext();

  return (
    <ScreenFrame title="设置" identityLabel="管理员值班台" onRefresh={context.refreshOverview}>
      <SettingsScreen
        baseUrl={context.baseUrl}
        isAdmin
        notificationsEnabled={context.notificationSettings.notificationsEnabled}
        notificationPermissionGranted={context.notificationPermissionGranted}
        guardServiceRunning={context.guardServiceRunning}
        batteryOptimizationIgnored={context.batteryOptimizationIgnored}
        adminCategorySettings={context.notificationSettings.adminCategories}
        personTaskNotificationsEnabled={context.notificationSettings.person.taskEvents}
        idleServerIds={Object.keys(context.notificationSettings.person.idleServerRules)}
        adminHiddenServerIds={context.notificationSettings.home.adminHiddenServerIds}
        servers={context.servers}
        notificationInbox={context.notificationInbox}
        onOpenBatteryOptimizationSettings={() => {
          void context.openBatteryOptimizationSettings();
        }}
        onToggleNotificationsEnabled={context.toggleNotificationsEnabled}
        onToggleAdminCategory={context.toggleAdminCategory}
        onTogglePersonTaskNotifications={context.togglePersonTaskNotifications}
        onToggleIdleServerSubscription={context.toggleIdleServerSubscription}
        onToggleAdminHiddenServer={context.toggleAdminHiddenServer}
        onSignOut={context.signOut}
      />
    </ScreenFrame>
  );
}

function AdminTabsNavigator() {
  const labels = Object.fromEntries(ADMIN_TAB_ROUTES.map((route) => [route.name, route.label]));

  return (
    <AdminTabs.Navigator backBehavior="initialRoute" screenOptions={tabScreenOptions} tabBar={(props) => <RoleTabBar {...props} />}>
      <AdminTabs.Screen name="OpsOverview" component={AdminOpsOverviewTab} options={{ tabBarLabel: labels.OpsOverview }} />
      <AdminTabs.Screen name="Nodes" component={AdminNodesTab} options={{ tabBarLabel: labels.Nodes }} />
      <AdminTabs.Screen name="Alerts" component={AdminAlertsTab} options={{ tabBarLabel: labels.Alerts }} />
      <AdminTabs.Screen name="AdminSettings" component={AdminSettingsTab} options={{ tabBarLabel: labels.AdminSettings }} />
    </AdminTabs.Navigator>
  );
}

function ServerDetailRoute(props: {
  serverId: string;
  isAdmin: boolean;
  onBack: () => void;
}) {
  const context = useMobileContext();
  const selectedServer = useMemo(
    () => context.servers.find((server: Server) => server.id === props.serverId) ?? null,
    [context.servers, props.serverId],
  );
  const selectedReport = context.latestMetrics[props.serverId];
  const { gpuRealtimeHistory, hostRealtimeHistory, realtimeHistoryLoading } = useServerGpuHistory(
    props.serverId,
    selectedReport,
    context.baseUrl,
    context.authToken,
  );

  if (!selectedServer) {
    return <MissingServerScreen onRefresh={context.refreshOverview} />;
  }

  return (
    <AuthenticatedShell
      title={selectedServer.name}
      subtitle={getShellSubtitle(context, props.isAdmin)}
      identityLabel={selectedServer.name}
      compact
      error={context.error}
      refreshing={context.refreshing}
      onRefresh={context.refreshOverview}
    >
      <ServerDetailScreen
        server={selectedServer}
        status={context.statuses[selectedServer.id]}
        report={selectedReport}
        hostRealtimeHistory={hostRealtimeHistory}
        gpuRealtimeHistory={gpuRealtimeHistory}
        realtimeHistoryLoading={realtimeHistoryLoading}
        isAdmin={props.isAdmin}
        subscribed={Boolean(context.notificationSettings.person.idleServerRules[selectedServer.id])}
        subscriptionRule={context.notificationSettings.person.idleServerRules[selectedServer.id] ?? null}
        onBack={props.onBack}
        onToggleSubscription={() => context.toggleIdleServerSubscription(selectedServer.id)}
        onSaveSubscriptionRule={(rule) => context.updateIdleServerRule(selectedServer.id, rule)}
      />
    </AuthenticatedShell>
  );
}

function AdminServerDetailScreen(props: NativeStackScreenProps<AdminStackParamList, 'AdminServerDetail'>) {
  return (
    <ServerDetailRoute
      serverId={props.route.params.serverId}
      isAdmin
      onBack={() => props.navigation.goBack()}
    />
  );
}

function AdminAlertDetailScreen(props: NativeStackScreenProps<AdminStackParamList, 'AdminAlertDetail'>) {
  const context = useMobileContext();
  const selectedAlert = useMemo(
    () => context.alerts.find((alert: PmeowAlert) => alert.id === props.route.params.alertId) ?? null,
    [context.alerts, props.route.params.alertId],
  );

  if (!selectedAlert) {
    return (
      <MissingAdminRecordScreen
        title="告警详情"
        description="该告警可能已经不在当前活动列表中。"
        onRefresh={context.refreshOverview}
      />
    );
  }

  return (
    <AuthenticatedShell
      title="告警详情"
      subtitle={getShellSubtitle(context, true)}
      error={context.error}
      refreshing={context.refreshing}
      onRefresh={context.refreshOverview}
    >
      <AdminAlertDetailView alert={selectedAlert} onBack={() => props.navigation.goBack()} />
    </AuthenticatedShell>
  );
}

function AdminSecurityEventDetailScreen(props: NativeStackScreenProps<AdminStackParamList, 'AdminSecurityEventDetail'>) {
  const context = useMobileContext();
  const selectedEvent = useMemo(
    () => context.securityEvents.find((event: SecurityEvent) => event.id === props.route.params.eventId) ?? null,
    [context.securityEvents, props.route.params.eventId],
  );

  if (!selectedEvent) {
    return (
      <MissingAdminRecordScreen
        title="安全事件详情"
        description="该安全事件可能已经被解决或不在当前列表中。"
        onRefresh={context.refreshOverview}
      />
    );
  }

  return (
    <AuthenticatedShell
      title="安全事件详情"
      subtitle={getShellSubtitle(context, true)}
      error={context.error}
      refreshing={context.refreshing}
      onRefresh={context.refreshOverview}
    >
      <AdminSecurityEventDetailView event={selectedEvent} onBack={() => props.navigation.goBack()} />
    </AuthenticatedShell>
  );
}

function AdminNavigator() {
  return (
    <AdminStack.Navigator screenOptions={{ headerShown: false }}>
      <AdminStack.Screen name="AdminTabs" component={AdminTabsNavigator} />
      <AdminStack.Screen name="AdminServerDetail" component={AdminServerDetailScreen} />
      <AdminStack.Screen name="AdminAlertDetail" component={AdminAlertDetailScreen} />
      <AdminStack.Screen name="AdminSecurityEventDetail" component={AdminSecurityEventDetailScreen} />
    </AdminStack.Navigator>
  );
}

function PersonResourcesTab(props: BottomTabScreenProps<PersonTabParamList, 'Resources'>) {
  const context = useMobileContext();
  const personName = getPersonName(context);
  const stackNavigation = props.navigation.getParent<NativeStackNavigationProp<PersonStackParamList>>();

  return (
    <ScreenFrame title="资源" identityLabel={`普通用户 · ${personName}`} onRefresh={context.refreshOverview}>
      <PersonHomeScreen
        personName={personName}
        servers={context.servers}
        statuses={context.statuses}
        latestMetrics={context.latestMetrics}
        personTasks={context.personTasks}
        recentTaskEvents={context.recentTaskEvents}
        notificationInbox={context.notificationInbox}
        homeView={context.notificationSettings.home.personView}
        onChangeHomeView={(view: MobileHomeView) => context.setHomeView('person', view)}
        onSelectServer={(serverId) => stackNavigation?.navigate('PersonServerDetail', { serverId })}
      />
    </ScreenFrame>
  );
}

function PersonTasksTab(props: BottomTabScreenProps<PersonTabParamList, 'MyTasks'>) {
  const context = useMobileContext();
  const personName = getPersonName(context);
  const stackNavigation = props.navigation.getParent<NativeStackNavigationProp<PersonStackParamList>>();

  return (
    <ScreenFrame title="我的任务" identityLabel={`普通用户 · ${personName}`} onRefresh={context.refreshOverview}>
      <PersonTasksScreen
        personTasks={context.personTasks}
        pendingTaskId={context.pendingTaskId}
        onSelectTask={(task) => stackNavigation?.navigate('PersonTaskDetail', { taskId: task.id })}
        onCancelTask={context.cancelTask}
      />
    </ScreenFrame>
  );
}

function PersonSettingsTab() {
  const context = useMobileContext();
  const personName = getPersonName(context);
  const personNotificationServers = useMemo(
    () => context.servers.filter((server) => (context.latestMetrics[server.id]?.resourceSnapshot.gpuCards.length ?? 0) > 0),
    [context.latestMetrics, context.servers],
  );

  return (
    <ScreenFrame title="设置" identityLabel={`普通用户 · ${personName}`} onRefresh={context.refreshOverview}>
      <SettingsScreen
        baseUrl={context.baseUrl}
        isAdmin={false}
        notificationsEnabled={context.notificationSettings.notificationsEnabled}
        notificationPermissionGranted={context.notificationPermissionGranted}
        guardServiceRunning={context.guardServiceRunning}
        batteryOptimizationIgnored={context.batteryOptimizationIgnored}
        adminCategorySettings={context.notificationSettings.adminCategories}
        personTaskNotificationsEnabled={context.notificationSettings.person.taskEvents}
        idleServerIds={Object.keys(context.notificationSettings.person.idleServerRules)}
        adminHiddenServerIds={context.notificationSettings.home.adminHiddenServerIds}
        servers={personNotificationServers}
        notificationInbox={context.notificationInbox}
        onOpenBatteryOptimizationSettings={() => {
          void context.openBatteryOptimizationSettings();
        }}
        onToggleNotificationsEnabled={context.toggleNotificationsEnabled}
        onToggleAdminCategory={context.toggleAdminCategory}
        onTogglePersonTaskNotifications={context.togglePersonTaskNotifications}
        onToggleIdleServerSubscription={context.toggleIdleServerSubscription}
        onToggleAdminHiddenServer={context.toggleAdminHiddenServer}
        onSignOut={context.signOut}
      />
    </ScreenFrame>
  );
}

function PersonTabsNavigator() {
  const labels = Object.fromEntries(PERSON_TAB_ROUTES.map((route) => [route.name, route.label]));

  return (
    <PersonTabs.Navigator backBehavior="initialRoute" screenOptions={tabScreenOptions} tabBar={(props) => <RoleTabBar {...props} />}>
      <PersonTabs.Screen name="Resources" component={PersonResourcesTab} options={{ tabBarLabel: labels.Resources }} />
      <PersonTabs.Screen name="MyTasks" component={PersonTasksTab} options={{ tabBarLabel: labels.MyTasks }} />
      <PersonTabs.Screen name="PersonSettings" component={PersonSettingsTab} options={{ tabBarLabel: labels.PersonSettings }} />
    </PersonTabs.Navigator>
  );
}

function PersonServerDetailScreen(props: NativeStackScreenProps<PersonStackParamList, 'PersonServerDetail'>) {
  return (
    <ServerDetailRoute
      serverId={props.route.params.serverId}
      isAdmin={false}
      onBack={() => props.navigation.goBack()}
    />
  );
}

function PersonTaskDetailRoute(props: NativeStackScreenProps<PersonStackParamList, 'PersonTaskDetail'>) {
  const context = useMobileContext();
  const personName = getPersonName(context);

  const handleRefresh = async () => {
    await context.refreshOverview();
    context.bumpTaskDetailRefreshNonce();
  };

  return (
    <AuthenticatedShell
      title="任务详情"
      subtitle={getShellSubtitle(context, false)}
      identityLabel={`普通用户 · ${personName}`}
      compact
      error={context.error}
      refreshing={context.refreshing}
      onRefresh={handleRefresh}
    >
      <PersonTaskDetailScreen
        taskId={props.route.params.taskId}
        baseUrl={context.baseUrl}
        authToken={context.authToken}
        refreshNonce={context.taskDetailRefreshNonce}
        onBack={() => props.navigation.goBack()}
        onRefreshOverview={context.refreshOverview}
      />
    </AuthenticatedShell>
  );
}

function PersonNavigator() {
  return (
    <PersonStack.Navigator screenOptions={{ headerShown: false }}>
      <PersonStack.Screen name="PersonTabs" component={PersonTabsNavigator} />
      <PersonStack.Screen name="PersonServerDetail" component={PersonServerDetailScreen} />
      <PersonStack.Screen name="PersonTaskDetail" component={PersonTaskDetailRoute} />
    </PersonStack.Navigator>
  );
}

export default function App() {
  const appState = useAppStore();
  const [taskDetailRefreshNonce, setTaskDetailRefreshNonce] = useState(0);
  const foregroundResumeInFlightRef = useRef(false);

  useEffect(() => {
    void appState.hydrate();
  }, [appState.hydrate]);

  useEffect(() => {
    void setNativeAppInForeground(true);
    const subscription = AppState.addEventListener('change', (nextState) => {
      const active = nextState === 'active';
      void setNativeAppInForeground(active);
      if (active) {
        void (async () => {
          await appState.refreshAndroidBackgroundState();
          if (!appState.session.authenticated || !appState.authToken || !appState.baseUrl || foregroundResumeInFlightRef.current) {
            return;
          }

          foregroundResumeInFlightRef.current = true;
          try {
            await appState.resumeRealtimeFromForeground();
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
  }, [
    appState.authToken,
    appState.baseUrl,
    appState.refreshAndroidBackgroundState,
    appState.resumeRealtimeFromForeground,
    appState.session.authenticated,
  ]);

  useEffect(() => {
    if (
      !appState.session.authenticated
      || !appState.notificationSettings.notificationsEnabled
      || !appState.guardServiceRunning
      || appState.batteryOptimizationIgnored !== false
      || appState.batteryOptimizationPromptShown
    ) {
      return;
    }

    appState.markBatteryOptimizationPromptShown();
    Alert.alert(
      '建议关闭电池优化',
      '为了提升最小化后的通知可靠性，建议为 PMEOW 关闭系统电池优化。',
      [
        { text: '稍后处理', style: 'cancel' },
        {
          text: '去设置',
          onPress: () => {
            void appState.openBatteryOptimizationSettings();
          },
        },
      ],
    );
  }, [
    appState.batteryOptimizationIgnored,
    appState.batteryOptimizationPromptShown,
    appState.guardServiceRunning,
    appState.markBatteryOptimizationPromptShown,
    appState.notificationSettings.notificationsEnabled,
    appState.openBatteryOptimizationSettings,
    appState.session.authenticated,
  ]);

  const contextValue = useMemo<MobileContextValue>(
    () => ({
      ...appState,
      taskDetailRefreshNonce,
      bumpTaskDetailRefreshNonce: () => setTaskDetailRefreshNonce((current) => current + 1),
    }),
    [appState, taskDetailRefreshNonce],
  );

  if (!appState.hydrated) {
    return (
      <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <StatusBar barStyle="light-content" />
        <View style={styles.loadingWrap}>
          <ActivityIndicator color="#86d5ff" size="large" />
          <Text style={styles.loadingText}>正在恢复移动端会话...</Text>
        </View>
      </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (!appState.session.authenticated) {
    return (
      <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <StatusBar barStyle="light-content" />
        <ConnectionScreen
          busy={appState.busy}
          error={appState.error}
          baseUrl={appState.baseUrl}
          mode={appState.mode}
          onChangeBaseUrl={appState.setBaseUrl}
          onChangeMode={appState.setMode}
          onSubmit={async (secret) => {
            await appState.signIn({ secret });
          }}
          onClearError={appState.clearError}
        />
      </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
    <MobileContext.Provider value={contextValue}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <StatusBar barStyle="light-content" />
        <NavigationContainer key={appState.session.principal.kind} theme={navigationTheme}>
          {appState.session.principal.kind === 'admin' ? <AdminNavigator /> : <PersonNavigator />}
        </NavigationContainer>
      </SafeAreaView>
    </MobileContext.Provider>
    </SafeAreaProvider>
  );
}
