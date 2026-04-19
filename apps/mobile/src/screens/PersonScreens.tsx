import { ScrollView, Text, View } from 'react-native';
import type { Server, ServerStatus, Task, TaskEvent, UnifiedReport } from '@pmeow/app-common';
import type { NotificationInboxItem } from '../lib/notification-inbox';
import { formatTaskEventLabel, formatTimestamp } from '../app/formatters';
import { styles } from '../app/styles';
import {
  NotificationInboxSection,
  SectionCard,
  ServerCard,
  StatBlock,
  TaskRow,
} from '../components/common';

export function PersonHomeScreen(props: {
  personName: string;
  servers: Server[];
  statuses: Record<string, ServerStatus>;
  latestMetrics: Record<string, UnifiedReport>;
  personTasks: Task[];
  recentTaskEvents: TaskEvent[];
  notificationInbox: NotificationInboxItem[];
  onSelectServer: (serverId: string) => void;
}) {
  const runningCount = props.personTasks.filter((task) => task.status === 'running').length;
  const queuedCount = props.personTasks.filter((task) => task.status === 'queued').length;
  const onlineCount = props.servers.filter((server) => props.statuses[server.id]?.status === 'online').length;

  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <SectionCard title={`${props.personName} 的值班首页`} description="只保留任务、机器和本地通知相关信息。">
        <View style={styles.summaryGrid}>
          <StatBlock label="运行任务" value={runningCount} />
          <StatBlock label="排队任务" value={queuedCount} />
        </View>
        <View style={styles.summaryGridCompact}>
          <StatBlock label="可见机器" value={props.servers.length} />
          <StatBlock label="在线机器" value={onlineCount} />
        </View>
      </SectionCard>

      <SectionCard title="机器列表" description="点击机器进入详情，可查看运行队列并管理空闲订阅。">
        {props.servers.length === 0 ? (
          <Text style={styles.emptyText}>当前没有与你绑定的机器。</Text>
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

      <SectionCard title="最近任务事件" description="与你可见范围相关的实时任务变更。">
        {props.recentTaskEvents.length === 0 ? (
          <Text style={styles.emptyText}>尚未收到任务实时事件。</Text>
        ) : (
          props.recentTaskEvents.map((event) => (
            <View key={`${event.serverId}-${event.task.taskId}-${event.eventType}-${event.task.createdAt}`} style={styles.eventRow}>
              <Text style={styles.eventTitle}>{formatTaskEventLabel(event)} · {event.task.command}</Text>
              <Text style={styles.eventMeta}>{event.serverId} · {formatTimestamp(event.task.createdAt)}</Text>
            </View>
          ))
        )}
      </SectionCard>

      <NotificationInboxSection items={props.notificationInbox.slice(0, 3)} />
    </ScrollView>
  );
}

export function PersonTasksScreen(props: {
  personTasks: Task[];
  pendingTaskId: string | null;
  onCancelTask: (task: Task) => Promise<void>;
}) {
  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <SectionCard title="我的任务" description="可取消自己当前仍在排队或运行中的任务。">
        {props.personTasks.length === 0 ? (
          <Text style={styles.emptyText}>当前没有与你绑定账号相关的任务。</Text>
        ) : (
          props.personTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              pending={props.pendingTaskId === task.id}
              onCancel={() => props.onCancelTask(task)}
            />
          ))
        )}
      </SectionCard>
    </ScrollView>
  );
}