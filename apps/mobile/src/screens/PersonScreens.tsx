import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Server, ServerStatus, Task, TaskEvent, UnifiedReport } from '@pmeow/app-common';
import type { NotificationInboxItem } from '../lib/notification-inbox';
import { formatTaskEventLabel, formatTimestamp } from '../app/formatters';
import { styles } from '../app/styles';
import type { MobileHomeView } from '../lib/preferences';
import {
  ExpandableList,
  GpuIdleBar,
  NotificationInboxSection,
  SectionCard,
  ServerCard,
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
  homeView: MobileHomeView;
  onChangeHomeView: (view: MobileHomeView) => void;
  onSelectServer: (serverId: string) => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <SectionCard title="机器视图" description="默认优先查看 GPU 空闲情况，也可切换到机器摘要。">
        <View style={styles.segmentRow}>
          <Pressable
            style={[styles.segment, props.homeView === 'gpuIdle' ? styles.segmentActive : null]}
            onPress={() => props.onChangeHomeView('gpuIdle')}
          >
            <Text style={[styles.segmentText, props.homeView === 'gpuIdle' ? styles.segmentTextActive : null]}>GPU 空闲情况</Text>
          </Pressable>
          <Pressable
            style={[styles.segment, props.homeView === 'summary' ? styles.segmentActive : null]}
            onPress={() => props.onChangeHomeView('summary')}
          >
            <Text style={[styles.segmentText, props.homeView === 'summary' ? styles.segmentTextActive : null]}>机器摘要</Text>
          </Pressable>
        </View>
        {props.servers.length === 0 ? (
          <Text style={styles.emptyText}>当前没有可见机器。</Text>
        ) : props.homeView === 'gpuIdle' ? (
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
          <ExpandableList
            totalCount={props.recentTaskEvents.length}
            initialVisibleCount={4}
            renderItems={(expanded) => {
              const visibleEvents = expanded ? props.recentTaskEvents : props.recentTaskEvents.slice(0, 4);

              return visibleEvents.map((event) => (
                <View key={`${event.serverId}-${event.task.taskId}-${event.eventType}-${event.task.createdAt}`} style={styles.eventRow}>
                  <Text style={styles.eventTitle}>{formatTaskEventLabel(event)} · {event.task.command}</Text>
                  <Text style={styles.eventMeta}>{event.serverId} · {formatTimestamp(event.task.createdAt)}</Text>
                </View>
              ));
            }}
          />
        )}
      </SectionCard>

      <NotificationInboxSection items={props.notificationInbox} initialVisibleCount={3} />
    </ScrollView>
  );
}

export function PersonTasksScreen(props: {
  personTasks: Task[];
  pendingTaskId: string | null;
  onSelectTask: (task: Task) => void;
  onCancelTask: (task: Task) => Promise<void>;
}) {
  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <SectionCard title="我的任务" description="点击任务可查看详情，仍可直接取消自己当前排队或运行中的任务。">
        {props.personTasks.length === 0 ? (
          <Text style={styles.emptyText}>当前没有与你绑定账号相关的任务。</Text>
        ) : (
          <ExpandableList
            totalCount={props.personTasks.length}
            initialVisibleCount={6}
            renderItems={(expanded) => {
              const visibleTasks = expanded ? props.personTasks : props.personTasks.slice(0, 6);
              return visibleTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  pending={props.pendingTaskId === task.id}
                  onPress={() => props.onSelectTask(task)}
                  onCancel={() => props.onCancelTask(task)}
                />
              ));
            }}
          />
        )}
      </SectionCard>
    </ScrollView>
  );
}
