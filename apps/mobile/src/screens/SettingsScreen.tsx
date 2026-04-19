import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import type { Server } from '@pmeow/app-common';
import type { NotificationInboxItem } from '../lib/notification-inbox';
import { styles } from '../app/styles';
import { NotificationInboxSection, SectionCard } from '../components/common';

export function SettingsScreen(props: {
  baseUrl: string;
  isAdmin: boolean;
  notificationsEnabled: boolean;
  notificationPermissionGranted: boolean | null;
  adminCategorySettings: {
    alerts: boolean;
    security: boolean;
    taskEvents: boolean;
  };
  personTaskNotificationsEnabled: boolean;
  idleServerIds: string[];
  servers: Server[];
  notificationInbox: NotificationInboxItem[];
  onToggleNotificationsEnabled: () => void;
  onToggleAdminCategory: (category: 'alerts' | 'security' | 'taskEvents') => void;
  onTogglePersonTaskNotifications: () => void;
  onToggleIdleServerSubscription: (serverId: string) => void;
  onSignOut: () => Promise<void>;
}) {
  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <SectionCard title="本地通知设置" description="所有开关与订阅都只保存在本机。">
        <View style={styles.preferenceRow}>
          <View style={styles.preferenceCopy}>
            <Text style={styles.preferenceTitle}>启用系统通知</Text>
            <Text style={styles.preferenceBody}>
              {props.notificationPermissionGranted === false ? '系统权限尚未授予。' : 'App 前后台存活时会按本地规则触发通知。'}
            </Text>
          </View>
          <Switch
            value={props.notificationsEnabled}
            onValueChange={props.onToggleNotificationsEnabled}
            trackColor={{ false: '#314657', true: '#2188c9' }}
            thumbColor="#f3f8fc"
          />
        </View>

        {props.isAdmin ? (
          <>
            <Pressable style={styles.preferenceRow} onPress={() => props.onToggleAdminCategory('alerts')}>
              <View style={styles.preferenceCopy}>
                <Text style={styles.preferenceTitle}>告警通知</Text>
                <Text style={styles.preferenceBody}>活动告警变化时发送系统通知。</Text>
              </View>
              <Text style={styles.preferenceValue}>{props.adminCategorySettings.alerts ? '开' : '关'}</Text>
            </Pressable>
            <Pressable style={styles.preferenceRow} onPress={() => props.onToggleAdminCategory('security')}>
              <View style={styles.preferenceCopy}>
                <Text style={styles.preferenceTitle}>安全事件通知</Text>
                <Text style={styles.preferenceBody}>新的未解决安全事件会触发系统通知。</Text>
              </View>
              <Text style={styles.preferenceValue}>{props.adminCategorySettings.security ? '开' : '关'}</Text>
            </Pressable>
            <Pressable style={styles.preferenceRow} onPress={() => props.onToggleAdminCategory('taskEvents')}>
              <View style={styles.preferenceCopy}>
                <Text style={styles.preferenceTitle}>任务事件通知</Text>
                <Text style={styles.preferenceBody}>任务提交、启动、结束时发送系统通知。</Text>
              </View>
              <Text style={styles.preferenceValue}>{props.adminCategorySettings.taskEvents ? '开' : '关'}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable style={styles.preferenceRow} onPress={props.onTogglePersonTaskNotifications}>
              <View style={styles.preferenceCopy}>
                <Text style={styles.preferenceTitle}>我的任务通知</Text>
                <Text style={styles.preferenceBody}>与你绑定账号相关的任务变更时发送系统通知。</Text>
              </View>
              <Text style={styles.preferenceValue}>{props.personTaskNotificationsEnabled ? '开' : '关'}</Text>
            </Pressable>
            <View style={styles.preferenceStack}>
              <Text style={styles.preferenceTitle}>机器空闲订阅</Text>
              <Text style={styles.preferenceBody}>当订阅机器从繁忙转为空闲时，在本机发送系统通知。</Text>
              {props.servers.length === 0 ? (
                <Text style={styles.emptyText}>当前没有可订阅的机器。</Text>
              ) : (
                <View style={styles.subscriptionWrap}>
                  {props.servers.map((server) => {
                    const active = props.idleServerIds.includes(server.id);
                    return (
                      <Pressable
                        key={server.id}
                        style={[styles.subscriptionChip, active ? styles.subscriptionChipActive : null]}
                        onPress={() => props.onToggleIdleServerSubscription(server.id)}
                      >
                        <Text style={[styles.subscriptionChipText, active ? styles.subscriptionChipTextActive : null]}>{server.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          </>
        )}
      </SectionCard>

      <NotificationInboxSection items={props.notificationInbox} />

      <SectionCard title="当前连接" description="连接地址仅用于当前 PMEOW 后端。">
        <Text style={styles.connectionMeta}>当前后端：{props.baseUrl}</Text>
        <Pressable style={styles.ghostButtonWide} onPress={() => void props.onSignOut()}>
          <Text style={styles.ghostButtonText}>退出登录</Text>
        </Pressable>
      </SectionCard>
    </ScrollView>
  );
}