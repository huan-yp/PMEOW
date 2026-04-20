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
import { styles } from '../app/styles';
import { ExpandableList, GpuIdleBar, SectionCard, ServerCard, StatBlock } from '../components/common';
import type { MobileHomeView } from '../lib/preferences';

export function AdminDashboardScreen(props: {
  realtimeConnected: boolean;
  serverCount: number;
  onlineCount: number;
  alertCount: number;
  securityCount: number;
  servers: Server[];
  statuses: Record<string, ServerStatus>;
  latestMetrics: Record<string, UnifiedReport>;
  recentTaskEvents: TaskEvent[];
  homeView: MobileHomeView;
  onChangeHomeView: (view: MobileHomeView) => void;
  onSelectServer: (serverId: string) => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <SectionCard title="当前概览" description={props.realtimeConnected ? '实时连接已建立。' : '实时连接未建立，建议手动刷新。'}>
        <View style={styles.summaryGridCompact}>
          <StatBlock label="可见机器" value={props.serverCount} />
          <StatBlock label="在线节点" value={props.onlineCount} />
        </View>
        <View style={styles.summaryGridTight}>
          <StatBlock label="活动告警" value={props.alertCount} />
          <StatBlock label="安全事件" value={props.securityCount} />
        </View>
      </SectionCard>

      <SectionCard title="机器视图" description="首页在机器摘要和 GPU 空闲情况之间切换，点击机器可进入详情。">
        <View style={styles.segmentRow}>
          <Pressable
            style={[styles.segment, props.homeView === 'summary' ? styles.segmentActive : null]}
            onPress={() => props.onChangeHomeView('summary')}
          >
            <Text style={[styles.segmentText, props.homeView === 'summary' ? styles.segmentTextActive : null]}>机器摘要</Text>
          </Pressable>
          <Pressable
            style={[styles.segment, props.homeView === 'gpuIdle' ? styles.segmentActive : null]}
            onPress={() => props.onChangeHomeView('gpuIdle')}
          >
            <Text style={[styles.segmentText, props.homeView === 'gpuIdle' ? styles.segmentTextActive : null]}>GPU 空闲情况</Text>
          </Pressable>
        </View>
        {props.servers.length === 0 ? (
          <Text style={styles.emptyText}>当前没有可展示的机器，或已被你在本机首页隐藏。</Text>
        ) : (
          props.homeView === 'summary' ? (
            props.servers.map((server) => (
              <ServerCard
                key={server.id}
                server={server}
                status={props.statuses[server.id]}
                report={props.latestMetrics[server.id]}
                onPress={() => props.onSelectServer(server.id)}
              />
            ))
          ) : (
            <View style={styles.gpuIdleSection}>
              {props.servers.map((server) => (
                <GpuIdleBar
                  key={server.id}
                  server={server}
                  report={props.latestMetrics[server.id]}
                  onPress={() => props.onSelectServer(server.id)}
                />
              ))}
            </View>
          )
        )}
      </SectionCard>

      <SectionCard title="最近任务事件" description="方便管理员快速确认当前集群活跃度。">
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
      </SectionCard>
    </ScrollView>
  );
}

export function AdminAlertsScreen(props: {
  alerts: Alert[];
  securityEvents: SecurityEvent[];
}) {
  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <SectionCard title="活动告警" description="只读展示当前活动中的告警。">
        {props.alerts.length === 0 ? (
          <Text style={styles.emptyText}>当前没有活动告警。</Text>
        ) : (
          <ExpandableList
            totalCount={props.alerts.length}
            initialVisibleCount={5}
            renderItems={(expanded) => {
              const visibleAlerts = expanded ? props.alerts : props.alerts.slice(0, 5);

              return visibleAlerts.map((alert) => (
                <View key={alert.id} style={styles.eventRow}>
                  <Text style={styles.eventTitle}>{formatAlertType(alert.alertType)} · {alert.serverId}</Text>
                  <Text style={styles.eventMeta}>{formatAlertValue(alert)} · 状态 {alert.status} · {formatTimestamp(alert.updatedAt)}</Text>
                </View>
              ));
            }}
          />
        )}
      </SectionCard>

      <SectionCard title="未解决安全事件" description="只读展示当前仍未关闭的安全事件。">
        {props.securityEvents.length === 0 ? (
          <Text style={styles.emptyText}>当前没有未解决安全事件。</Text>
        ) : (
          <ExpandableList
            totalCount={props.securityEvents.length}
            initialVisibleCount={5}
            renderItems={(expanded) => {
              const visibleEvents = expanded ? props.securityEvents : props.securityEvents.slice(0, 5);

              return visibleEvents.map((event) => (
                <View key={event.id} style={styles.eventRow}>
                  <Text style={styles.eventTitle}>{formatSecurityEventType(event.eventType)} · {event.serverId}</Text>
                  <Text style={styles.eventMeta}>{formatTimestamp(event.createdAt)}</Text>
                </View>
              ));
            }}
          />
        )}
      </SectionCard>
    </ScrollView>
  );
}