import { useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import type { Server } from '@pmeow/app-common';
import type { NotificationInboxItem } from '../lib/notification-inbox';
import { ADMIN_SETTINGS_SECONDARY_PAGES, PERSON_SETTINGS_SECONDARY_PAGES, type AdminSettingsSecondaryPageId, type PersonSettingsSecondaryPageId } from '../app/navigation';
import { styles } from '../app/styles';
import { NotificationInboxSection, PageSection, RefreshableScrollView, SecondarySwipeView } from '../components/common';

export function SettingsScreen(props: {
  baseUrl: string;
  isAdmin: boolean;
  notificationsEnabled: boolean;
  notificationPermissionGranted: boolean | null;
  guardServiceRunning: boolean;
  batteryOptimizationIgnored: boolean | null;
  adminCategorySettings: {
    alerts: boolean;
    security: boolean;
    taskEvents: boolean;
  };
  personTaskNotificationsEnabled: boolean;
  idleServerIds: string[];
  adminHiddenServerIds: string[];
  servers: Server[];
  notificationInbox: NotificationInboxItem[];
  onOpenBatteryOptimizationSettings: () => void;
  onToggleNotificationsEnabled: () => void;
  onToggleAdminCategory: (category: 'alerts' | 'security' | 'taskEvents') => void;
  onTogglePersonTaskNotifications: () => void;
  onToggleIdleServerSubscription: (serverId: string) => void;
  onToggleAdminHiddenServer: (serverId: string) => void;
  onSignOut: () => Promise<void>;
}) {
  const [activeAdminPage, setActiveAdminPage] = useState<AdminSettingsSecondaryPageId>('localNotifications');

  const notificationSettings = (
    <View style={styles.sectionPanel}>
      <View style={[styles.preferenceRow, styles.preferenceRowInset]}>
        <View style={styles.preferenceCopy}>
          <Text style={styles.preferenceTitle}>启用系统通知</Text>
          <Text style={styles.preferenceBody}>
            {props.notificationPermissionGranted === false ? '系统权限尚未授予。' : '默认开启横幅通知；登录后会自动启动后台值守服务。'}
          </Text>
        </View>
        <Switch
          value={props.notificationsEnabled}
          onValueChange={props.onToggleNotificationsEnabled}
          trackColor={{ false: '#314657', true: '#2188c9' }}
          thumbColor="#f3f8fc"
        />
      </View>

      <View style={[styles.preferenceRow, styles.preferenceRowInset]}>
        <View style={styles.preferenceCopy}>
          <Text style={styles.preferenceTitle}>后台值守服务</Text>
          <Text style={styles.preferenceBody}>登录成功且系统通知开启后，安卓会启动前台服务保障实时通知。</Text>
        </View>
        <Text style={styles.preferenceValue}>{props.guardServiceRunning ? '运行中' : '未运行'}</Text>
      </View>

      <Pressable style={[styles.preferenceRow, styles.preferenceRowInset]} onPress={props.onOpenBatteryOptimizationSettings}>
        <View style={styles.preferenceCopy}>
          <Text style={styles.preferenceTitle}>电池优化白名单</Text>
          <Text style={styles.preferenceBody}>建议关闭系统电池优化，减少最小化后被系统回收的概率。</Text>
        </View>
        <Text style={styles.preferenceValue}>
          {props.batteryOptimizationIgnored == null ? '未知' : props.batteryOptimizationIgnored ? '已放行' : '去设置'}
        </Text>
      </Pressable>

      {props.isAdmin ? (
        <>
          <View style={[styles.preferenceRow, styles.preferenceRowInset]}>
            <View style={styles.preferenceCopy}>
              <Text style={styles.preferenceTitle}>告警通知</Text>
              <Text style={styles.preferenceBody}>活动告警变化时发送系统通知。</Text>
            </View>
            <Switch
              value={props.adminCategorySettings.alerts}
              onValueChange={() => props.onToggleAdminCategory('alerts')}
              trackColor={{ false: '#314657', true: '#2188c9' }}
              thumbColor="#f3f8fc"
            />
          </View>
          <View style={[styles.preferenceRow, styles.preferenceRowInset]}>
            <View style={styles.preferenceCopy}>
              <Text style={styles.preferenceTitle}>安全事件通知</Text>
              <Text style={styles.preferenceBody}>新的未解决安全事件会触发系统通知。</Text>
            </View>
            <Switch
              value={props.adminCategorySettings.security}
              onValueChange={() => props.onToggleAdminCategory('security')}
              trackColor={{ false: '#314657', true: '#2188c9' }}
              thumbColor="#f3f8fc"
            />
          </View>
          <View style={[styles.preferenceRow, styles.preferenceRowInset]}>
            <View style={styles.preferenceCopy}>
              <Text style={styles.preferenceTitle}>任务事件通知</Text>
              <Text style={styles.preferenceBody}>任务提交、启动、结束时发送系统通知。</Text>
            </View>
            <Switch
              value={props.adminCategorySettings.taskEvents}
              onValueChange={() => props.onToggleAdminCategory('taskEvents')}
              trackColor={{ false: '#314657', true: '#2188c9' }}
              thumbColor="#f3f8fc"
            />
          </View>
          <View style={[styles.preferenceStack, styles.preferenceRowInset]}>
            <Text style={styles.preferenceTitle}>首页隐藏机器</Text>
            <Text style={styles.preferenceBody}>只影响当前设备上的管理员首页，不会改变其他设备或账号的可见范围。</Text>
            {props.servers.length === 0 ? (
              <Text style={styles.emptyText}>当前没有可设置的机器。</Text>
            ) : (
              <View style={styles.panelStack}>
                {props.servers.map((server) => {
                  const hidden = props.adminHiddenServerIds.includes(server.id);

                  return (
                    <View key={server.id} style={[styles.preferenceRow, styles.preferenceRowInset]}>
                      <View style={styles.preferenceCopy}>
                        <Text style={styles.preferenceTitle}>{server.name}</Text>
                        <Text style={styles.preferenceBody}>{hidden ? '已从当前设备首页隐藏' : '显示在当前设备首页'}</Text>
                      </View>
                      <Switch
                        value={hidden}
                        onValueChange={() => props.onToggleAdminHiddenServer(server.id)}
                        trackColor={{ false: '#314657', true: '#2188c9' }}
                        thumbColor="#f3f8fc"
                      />
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </>
      ) : (
        <>
          <View style={[styles.preferenceRow, styles.preferenceRowInset]}>
            <View style={styles.preferenceCopy}>
              <Text style={styles.preferenceTitle}>我的任务通知</Text>
              <Text style={styles.preferenceBody}>与你绑定账号相关的任务变更时发送系统通知。</Text>
            </View>
            <Switch
              value={props.personTaskNotificationsEnabled}
              onValueChange={props.onTogglePersonTaskNotifications}
              trackColor={{ false: '#314657', true: '#2188c9' }}
              thumbColor="#f3f8fc"
            />
          </View>
          <View style={[styles.preferenceStack, styles.preferenceRowInset]}>
            <Text style={styles.preferenceTitle}>机器空闲订阅</Text>
            <Text style={styles.preferenceBody}>按机器订阅 GPU 空闲规则；具体阈值在机器详情页编辑。</Text>
            {props.servers.length === 0 ? (
              <Text style={styles.emptyText}>当前没有可订阅的 GPU 机器。</Text>
            ) : (
              <View style={styles.panelStack}>
                {props.servers.map((server) => {
                  const active = props.idleServerIds.includes(server.id);
                  return (
                    <View key={server.id} style={[styles.preferenceRow, styles.preferenceRowInset]}>
                      <View style={styles.preferenceCopy}>
                        <Text style={styles.preferenceTitle}>{server.name}</Text>
                        <Text style={styles.preferenceBody}>{active ? '已订阅 GPU 空闲提醒' : '未订阅 GPU 空闲提醒'}</Text>
                      </View>
                      <Switch
                        value={active}
                        onValueChange={() => props.onToggleIdleServerSubscription(server.id)}
                        trackColor={{ false: '#314657', true: '#2188c9' }}
                        thumbColor="#f3f8fc"
                      />
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </>
      )}
    </View>
  );

  const [activePersonPage, setActivePersonPage] = useState<PersonSettingsSecondaryPageId>('localNotifications');

  if (props.isAdmin) {
    return (
      <RefreshableScrollView contentContainerStyle={styles.screenContent}>
        <PageSection title="设置" description="按模块管理本机通知、通知记录和当前连接。">
          <SecondarySwipeView
            pages={ADMIN_SETTINGS_SECONDARY_PAGES}
            activePage={activeAdminPage}
            onChangePage={setActiveAdminPage}
            renderPage={(page) => {
              if (page === 'localNotifications') {
                return notificationSettings;
              }
              if (page === 'notificationInbox') {
                return <NotificationInboxSection items={props.notificationInbox} initialVisibleCount={8} />;
              }
              return (
                <View style={styles.sectionPanel}>
                  <Text style={styles.connectionMeta}>当前后端：{props.baseUrl}</Text>
                  <Pressable style={styles.ghostButtonWide} onPress={() => void props.onSignOut()}>
                    <Text style={styles.ghostButtonText}>退出登录</Text>
                  </Pressable>
                </View>
              );
            }}
          />
        </PageSection>
      </RefreshableScrollView>
    );
  }

  return (
    <RefreshableScrollView contentContainerStyle={styles.screenContent}>
      <PageSection title="设置" description="按模块管理本机通知、通知记录和当前连接。">
        <SecondarySwipeView
          pages={PERSON_SETTINGS_SECONDARY_PAGES}
          activePage={activePersonPage}
          onChangePage={setActivePersonPage}
          renderPage={(page) => {
            if (page === 'localNotifications') {
              return notificationSettings;
            }
            if (page === 'notificationInbox') {
              return <NotificationInboxSection items={props.notificationInbox} initialVisibleCount={8} />;
            }
            return (
              <View style={styles.sectionPanel}>
                <Text style={styles.connectionMeta}>当前后端：{props.baseUrl}</Text>
                <Pressable style={styles.ghostButtonWide} onPress={() => void props.onSignOut()}>
                  <Text style={styles.ghostButtonText}>退出登录</Text>
                </Pressable>
              </View>
            );
          }}
        />
      </PageSection>
    </RefreshableScrollView>
  );
}
