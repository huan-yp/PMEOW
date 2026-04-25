import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type {
  Alert,
  SecurityEvent,
  Server,
  ServerStatus,
  TaskEvent,
  UnifiedReport,
} from '@pmeow/app-common';
import {
  formatAlertType,
  formatAlertValue,
  formatSecurityEventType,
  formatTaskEventLabel,
  formatTimestamp,
} from '../app/formatters';
import { ADMIN_ALERT_SECONDARY_PAGES, type AdminAlertSecondaryPageId } from '../app/navigation';
import { styles } from '../app/styles';
import { ExpandableList, MachineViewPager, PageSection, SecondarySwipeView } from '../components/common';
import type { MobileHomeView } from '../lib/preferences';

export function AdminOpsOverviewScreen(props: {
  realtimeConnected: boolean;
  serverCount: number;
  onlineCount: number;
  alertCount: number;
  securityCount: number;
  alerts: Alert[];
  securityEvents: SecurityEvent[];
  recentTaskEvents: TaskEvent[];
  onSelectAlert: (alertId: number) => void;
  onSelectSecurityEvent: (eventId: number) => void;
}) {
  const latestAlert = props.alerts[0] ?? null;
  const latestSecurityEvent = props.securityEvents[0] ?? null;
  const onlineRatio = props.serverCount === 0 ? 0 : Math.round((props.onlineCount / props.serverCount) * 100);

  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <PageSection title="当前概览" description={props.realtimeConnected ? '实时连接已建立。' : '实时连接未建立，建议手动刷新。'}>
        <View style={styles.dashboardHero}>
          <View style={styles.dashboardHeroHeader}>
            <View>
              <Text style={styles.dashboardHeroTitle}>机器健康度</Text>
              <Text style={styles.dashboardHeroMeta}>在线 {props.onlineCount} / 可见 {props.serverCount}</Text>
            </View>
            <Text style={styles.dashboardHeroValue}>{onlineRatio}%</Text>
          </View>
          <View style={styles.dashboardProgressTrack}>
            <View style={[styles.dashboardProgressFill, { width: `${onlineRatio}%` }]} />
          </View>
        </View>

        <View style={styles.dashboardActionGrid}>
          <Pressable
            style={[styles.dashboardActionCard, props.alertCount > 0 ? styles.dashboardActionCardWarn : null]}
            disabled={!latestAlert}
            onPress={() => {
              if (latestAlert) props.onSelectAlert(latestAlert.id);
            }}
          >
            <Text style={styles.dashboardActionLabel}>活动告警</Text>
            <Text style={styles.dashboardActionValue}>{props.alertCount}</Text>
            <Text style={styles.dashboardActionMeta}>
              {latestAlert ? `${formatAlertType(latestAlert.alertType)} · ${latestAlert.serverId}` : '当前无活动告警'}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.dashboardActionCard, props.securityCount > 0 ? styles.dashboardActionCardDanger : null]}
            disabled={!latestSecurityEvent}
            onPress={() => {
              if (latestSecurityEvent) props.onSelectSecurityEvent(latestSecurityEvent.id);
            }}
          >
            <Text style={styles.dashboardActionLabel}>安全事件</Text>
            <Text style={styles.dashboardActionValue}>{props.securityCount}</Text>
            <Text style={styles.dashboardActionMeta}>
              {latestSecurityEvent ? `${formatSecurityEventType(latestSecurityEvent.eventType)} · ${latestSecurityEvent.serverId}` : '当前无安全事件'}
            </Text>
          </Pressable>
        </View>
      </PageSection>

      <PageSection title="最近任务事件" description="方便管理员快速确认当前集群活跃度。">
        <View style={styles.sectionPanel}>
          {props.recentTaskEvents.length === 0 ? (
            <Text style={styles.emptyText}>尚未收到实时任务事件。</Text>
          ) : (
            <ExpandableList
              totalCount={props.recentTaskEvents.length}
              initialVisibleCount={5}
              renderItems={(expanded) => {
                const visibleEvents = expanded ? props.recentTaskEvents : props.recentTaskEvents.slice(0, 5);

                return visibleEvents.map((event) => (
                  <View key={`${event.serverId}-${event.task.taskId}-${event.eventType}-${event.task.createdAt}`} style={styles.eventRow}>
                    <Text style={styles.eventTitle}>{formatTaskEventLabel(event)} · {event.task.command}</Text>
                    <Text style={styles.eventMeta}>{event.serverId} · {event.task.user} · {formatTimestamp(event.task.createdAt)}</Text>
                  </View>
                ));
              }}
            />
          )}
        </View>
      </PageSection>
    </ScrollView>
  );
}

export function AdminNodesScreen(props: {
  servers: Server[];
  statuses: Record<string, ServerStatus>;
  latestMetrics: Record<string, UnifiedReport>;
  homeView: MobileHomeView;
  onChangeHomeView: (view: MobileHomeView) => void;
  onSelectServer: (serverId: string) => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <PageSection title="机器视图" description="左右滑动切换机器摘要和 GPU 空闲情况，点按机器摘要可展开状态信息。">
        <MachineViewPager
          view={props.homeView}
          onChangeView={props.onChangeHomeView}
          servers={props.servers}
          statuses={props.statuses}
          latestMetrics={props.latestMetrics}
          emptyText="当前没有可展示的机器，或已被你在本机首页隐藏。"
          onSelectServer={props.onSelectServer}
        />
      </PageSection>
    </ScrollView>
  );
}

export function AdminAlertsScreen(props: {
  alerts: Alert[];
  securityEvents: SecurityEvent[];
  onSelectAlert: (alertId: number) => void;
  onSelectSecurityEvent: (eventId: number) => void;
}) {
  const [activePage, setActivePage] = useState<AdminAlertSecondaryPageId>('activeAlerts');

  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <PageSection title="告警中心" description="按功能分组查看活动告警和未解决安全事件。">
        <SecondarySwipeView
          pages={ADMIN_ALERT_SECONDARY_PAGES}
          activePage={activePage}
          onChangePage={setActivePage}
          renderPage={(page) => (
            <View style={styles.sectionPanel}>
              {page === 'activeAlerts' ? (
                props.alerts.length === 0 ? (
                  <Text style={styles.emptyText}>当前没有活动告警。</Text>
                ) : (
                  <ExpandableList
                    totalCount={props.alerts.length}
                    initialVisibleCount={5}
                    renderItems={(expanded) => {
                      const visibleAlerts = expanded ? props.alerts : props.alerts.slice(0, 5);

                      return visibleAlerts.map((alert) => (
                        <Pressable key={alert.id} style={styles.eventRowCard} onPress={() => props.onSelectAlert(alert.id)}>
                          <Text style={styles.eventTitle}>{formatAlertType(alert.alertType)} · {alert.serverId}</Text>
                          <Text style={styles.eventMeta}>{formatAlertValue(alert)} · 状态 {alert.status} · {formatTimestamp(alert.updatedAt)}</Text>
                        </Pressable>
                      ));
                    }}
                  />
                )
              ) : props.securityEvents.length === 0 ? (
                <Text style={styles.emptyText}>当前没有未解决安全事件。</Text>
              ) : (
                <ExpandableList
                  totalCount={props.securityEvents.length}
                  initialVisibleCount={5}
                  renderItems={(expanded) => {
                    const visibleEvents = expanded ? props.securityEvents : props.securityEvents.slice(0, 5);

                    return visibleEvents.map((event) => (
                      <Pressable key={event.id} style={styles.eventRowCard} onPress={() => props.onSelectSecurityEvent(event.id)}>
                        <Text style={styles.eventTitle}>{formatSecurityEventType(event.eventType)} · {event.serverId}</Text>
                        <Text style={styles.eventMeta}>{formatTimestamp(event.createdAt)}</Text>
                      </Pressable>
                    ));
                  }}
                />
              )}
            </View>
          )}
        />
      </PageSection>
    </ScrollView>
  );
}

export function AdminAlertDetailView(props: {
  alert: Alert;
  onBack: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <Pressable style={styles.detailBackButton} onPress={props.onBack}>
        <Text style={styles.detailBackButtonText}>返回</Text>
      </Pressable>
      <PageSection title="活动告警详情" description={`${formatAlertType(props.alert.alertType)} · ${props.alert.serverId}`}>
        <View style={styles.sectionPanel}>
          <View style={styles.detailPanel}>
            <Text style={styles.detailPanelTitle}>告警类型</Text>
            <Text style={styles.detailPanelValue}>{formatAlertType(props.alert.alertType)}</Text>
            <Text style={styles.detailPanelMeta}>状态 {props.alert.status}</Text>
          </View>
          <View style={styles.detailPanel}>
            <Text style={styles.detailPanelTitle}>当前值</Text>
            <Text style={styles.detailPanelValue}>{formatAlertValue(props.alert)}</Text>
            <Text style={styles.detailPanelMeta}>
              阈值 {props.alert.threshold == null ? '--' : props.alert.threshold} · 指纹 {props.alert.fingerprint}
            </Text>
          </View>
          <View style={styles.detailPanel}>
            <Text style={styles.detailPanelTitle}>时间</Text>
            <Text style={styles.detailPanelMeta}>创建：{formatTimestamp(props.alert.createdAt)}</Text>
            <Text style={styles.detailPanelMeta}>更新：{formatTimestamp(props.alert.updatedAt)}</Text>
          </View>
        </View>
      </PageSection>
    </ScrollView>
  );
}

export function AdminSecurityEventDetailView(props: {
  event: SecurityEvent;
  onBack: () => void;
}) {
  const details = props.event.details;

  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <Pressable style={styles.detailBackButton} onPress={props.onBack}>
        <Text style={styles.detailBackButtonText}>返回</Text>
      </Pressable>
      <PageSection title="安全事件详情" description={`${formatSecurityEventType(props.event.eventType)} · ${props.event.serverId}`}>
        <View style={styles.sectionPanel}>
          <View style={styles.detailPanel}>
            <Text style={styles.detailPanelTitle}>事件类型</Text>
            <Text style={styles.detailPanelValue}>{formatSecurityEventType(props.event.eventType)}</Text>
            <Text style={styles.detailPanelMeta}>{props.event.resolved ? '已解决' : '未解决'} · 指纹 {props.event.fingerprint}</Text>
          </View>
          <View style={styles.detailPanel}>
            <Text style={styles.detailPanelTitle}>原因</Text>
            <Text style={styles.detailPanelMeta}>{details.reason}</Text>
            {details.command ? <Text style={styles.detailPanelMeta}>命令：{details.command}</Text> : null}
            {details.user ? <Text style={styles.detailPanelMeta}>用户：{details.user}</Text> : null}
            {details.pid ? <Text style={styles.detailPanelMeta}>PID：{details.pid}</Text> : null}
            {details.gpuIndex != null ? <Text style={styles.detailPanelMeta}>GPU：{details.gpuIndex}</Text> : null}
          </View>
          <View style={styles.detailPanel}>
            <Text style={styles.detailPanelTitle}>时间</Text>
            <Text style={styles.detailPanelMeta}>创建：{formatTimestamp(props.event.createdAt)}</Text>
            <Text style={styles.detailPanelMeta}>解决：{formatTimestamp(props.event.resolvedAt)}</Text>
          </View>
        </View>
      </PageSection>
    </ScrollView>
  );
}
