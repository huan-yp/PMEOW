import { ScrollView, Text, View } from 'react-native';
import type { Server, ServerStatus, Task, TaskEvent, UnifiedReport } from '@pmeow/app-common';
import type { NotificationInboxItem } from '../lib/notification-inbox';
import { formatTaskEventLabel, formatTimestamp } from '../app/formatters';
import { styles } from '../app/styles';
import type { MobileHomeView } from '../lib/preferences';
import {
  ExpandableList,
  MachineViewPager,
  NotificationInboxSection,
  PageSection,
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
      <PageSection title="机器视图" description="左右滑动切换机器摘要和 GPU 空闲情况，点按机器摘要可展开状态信息。">
        <MachineViewPager
          view={props.homeView}
          onChangeView={props.onChangeHomeView}
          servers={props.servers}
          statuses={props.statuses}
          latestMetrics={props.latestMetrics}
          emptyText="当前没有可见机器。"
          onSelectServer={props.onSelectServer}
        />
      </PageSection>

      <PageSection title="最近任务事件" description="与你可见范围相关的实时任务变更。">
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
      </PageSection>

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
      <PageSection title="我的任务" description="点击任务可查看详情，仍可直接取消自己当前排队或运行中的任务。">
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
      </PageSection>
    </ScrollView>
  );
}
