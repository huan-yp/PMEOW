import { ScrollView, Text, View } from 'react-native';
import type {
  Alert,
  SecurityEvent,
  Server,
  ServerStatus,
  TaskEvent,
  UnifiedReport,
} from '@monitor/app-common';
import {
  formatAlertType,
  formatAlertValue,
  formatSecurityEventType,
  formatTaskEventLabel,
  formatTimestamp,
} from '../app/formatters';
import { styles } from '../app/styles';
import { SectionCard, ServerCard, StatBlock } from '../components/common';

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
  onSelectServer: (serverId: string) => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <SectionCard title="当前概览" description={props.realtimeConnected ? '实时连接已建立。' : '实时连接未建立，建议手动刷新。'}>
        <View style={styles.summaryGrid}>
          <StatBlock label="可见机器" value={props.serverCount} />
          <StatBlock label="在线节点" value={props.onlineCount} />
        </View>
        <View style={styles.summaryGridCompact}>
          <StatBlock label="活动告警" value={props.alertCount} />
          <StatBlock label="安全事件" value={props.securityCount} />
        </View>
      </SectionCard>

      <SectionCard title="机器摘要" description="点击机器进入详情。">
        {props.servers.length === 0 ? (
          <Text style={styles.emptyText}>当前没有可见节点。</Text>
        ) : (
          props.servers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              status={props.statuses[server.id]}
              report={props.latestMetrics[server.id]}
              onPress={() => props.onSelectServer(server.id)}
            />
          ))
        )}
      </SectionCard>

      <SectionCard title="最近任务事件" description="方便管理员快速确认当前集群活跃度。">
        {props.recentTaskEvents.length === 0 ? (
          <Text style={styles.emptyText}>尚未收到实时任务事件。</Text>
        ) : (
          props.recentTaskEvents.map((event) => (
            <View key={`${event.serverId}-${event.task.taskId}-${event.eventType}-${event.task.createdAt}`} style={styles.eventRow}>
              <Text style={styles.eventTitle}>{formatTaskEventLabel(event)} · {event.task.command}</Text>
              <Text style={styles.eventMeta}>{event.serverId} · {event.task.user} · {formatTimestamp(event.task.createdAt)}</Text>
            </View>
          ))
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
          props.alerts.map((alert) => (
            <View key={alert.id} style={styles.eventRow}>
              <Text style={styles.eventTitle}>{formatAlertType(alert.alertType)} · {alert.serverId}</Text>
              <Text style={styles.eventMeta}>{formatAlertValue(alert)} · 状态 {alert.status} · {formatTimestamp(alert.updatedAt)}</Text>
            </View>
          ))
        )}
      </SectionCard>

      <SectionCard title="未解决安全事件" description="只读展示当前仍未关闭的安全事件。">
        {props.securityEvents.length === 0 ? (
          <Text style={styles.emptyText}>当前没有未解决安全事件。</Text>
        ) : (
          props.securityEvents.map((event) => (
            <View key={event.id} style={styles.eventRow}>
              <Text style={styles.eventTitle}>{formatSecurityEventType(event.eventType)} · {event.serverId}</Text>
              <Text style={styles.eventMeta}>{formatTimestamp(event.createdAt)}</Text>
            </View>
          ))
        )}
      </SectionCard>
    </ScrollView>
  );
}