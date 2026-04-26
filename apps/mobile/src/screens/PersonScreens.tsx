import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Server, ServerStatus, Task, TaskEvent, UnifiedReport } from '@pmeow/app-common';
import type { NotificationInboxItem } from '../lib/notification-inbox';
import { formatTaskEventLabel, formatTimestamp } from '../app/formatters';
import { PERSON_NOTIFICATION_SECONDARY_PAGES, PERSON_TASK_SECONDARY_PAGES, type PersonNotificationSecondaryPageId, type PersonTaskSecondaryPageId } from '../app/navigation';
import { styles } from '../app/styles';
import type { MobileHomeView } from '../lib/preferences';
import {
  ExpandableList,
  MachineViewPager,
  NotificationInboxSection,
  PageSection,
  RefreshableScrollView,
  SecondarySwipeView,
  TaskRow,
} from '../components/common';

export function PersonHomeScreen(props: {
  personName: string;
  servers: Server[];
  statuses: Record<string, ServerStatus>;
  latestMetrics: Record<string, UnifiedReport>;
  personTasks: Task[];
  homeView: MobileHomeView;
  onChangeHomeView: (view: MobileHomeView) => void;
  onSelectServer: (serverId: string) => void;
  subscribedServerCount: number;
  onNavigateToTasks: () => void;
  onNavigateToNotifications: () => void;
}) {
  const onlineCount = props.servers.filter((server) => props.statuses[server.id]?.status === 'online').length;
  const onlineRatio = props.servers.length === 0 ? 0 : Math.round((onlineCount / props.servers.length) * 100);
  const taskCount = props.personTasks.length;

  return (
    <RefreshableScrollView contentContainerStyle={styles.screenContent}>
      <PageSection title="当前概览" description="当前机器总览、任务与订阅统计，左右滑动切换机器摘要和 GPU 空闲情况。">
        <View style={styles.dashboardHero}>
          <View style={styles.dashboardHeroHeader}>
            <View>
              <Text style={styles.dashboardHeroTitle}>机器健康度</Text>
              <Text style={styles.dashboardHeroMeta}>在线 {onlineCount} / 可见 {props.servers.length}</Text>
            </View>
            <Text style={styles.dashboardHeroValue}>{onlineRatio}%</Text>
          </View>
          <View style={styles.dashboardProgressTrack}>
            <View style={[styles.dashboardProgressFill, { width: `${onlineRatio}%` }]} />
          </View>
        </View>

        <View style={styles.dashboardActionGrid}>
          <Pressable style={styles.dashboardActionCard} onPress={props.onNavigateToTasks}>
            <Text style={styles.dashboardActionLabel}>我的任务</Text>
            <Text style={styles.dashboardActionValue}>{taskCount}</Text>
            <Text style={styles.dashboardActionMeta}>
              {taskCount > 0 ? `${props.personTasks.filter((t) => t.status === 'queued' || t.status === 'running').length} 个进行中` : '当前没有相关任务'}
            </Text>
          </Pressable>
          <Pressable style={styles.dashboardActionCard} onPress={props.onNavigateToNotifications}>
            <Text style={styles.dashboardActionLabel}>已订阅机器</Text>
            <Text style={styles.dashboardActionValue}>{props.subscribedServerCount}</Text>
            <Text style={styles.dashboardActionMeta}>
              {props.subscribedServerCount > 0 ? '正在接收空闲提醒' : '尚未订阅任何机器'}
            </Text>
          </Pressable>
        </View>

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
    </RefreshableScrollView>
  );
}

export function PersonNotificationsScreen(props: {
  recentTaskEvents: TaskEvent[];
  notificationInbox: NotificationInboxItem[];
  onSelectServer: (serverId: string) => void;
}) {
  const [activePage, setActivePage] = useState<PersonNotificationSecondaryPageId>('taskEvents');

  return (
    <RefreshableScrollView contentContainerStyle={styles.screenContent}>
      <PageSection title="通知" description="与你可见范围相关的实时任务变更和系统通知。">
        <SecondarySwipeView
          pages={PERSON_NOTIFICATION_SECONDARY_PAGES}
          activePage={activePage}
          onChangePage={setActivePage}
          renderPage={(page) => (
            <View style={styles.sectionPanel}>
              {page === 'taskEvents' ? (
                props.recentTaskEvents.length === 0 ? (
                  <Text style={styles.emptyText}>尚未收到任务实时事件。</Text>
                ) : (
                  <ExpandableList
                    totalCount={props.recentTaskEvents.length}
                    initialVisibleCount={5}
                    renderItems={(expanded) => {
                      const visibleEvents = expanded ? props.recentTaskEvents : props.recentTaskEvents.slice(0, 5);

                      return visibleEvents.map((event) => (
                        <Pressable
                          key={`${event.serverId}-${event.task.taskId}-${event.eventType}-${event.task.createdAt}`}
                          style={styles.eventRowCard}
                          onPress={() => props.onSelectServer(event.serverId)}
                        >
                          <Text style={styles.eventTitle}>{formatTaskEventLabel(event)} · {event.task.command}</Text>
                          <Text style={styles.eventMeta}>{event.serverId} · {formatTimestamp(event.task.createdAt)}</Text>
                        </Pressable>
                      ));
                    }}
                  />
                )
              ) : (
                <NotificationInboxSection items={props.notificationInbox} initialVisibleCount={5} />
              )}
            </View>
          )}
        />
      </PageSection>
    </RefreshableScrollView>
  );
}

export function PersonTasksScreen(props: {
  personTasks: Task[];
  pendingTaskId: string | null;
  onSelectTask: (task: Task) => void;
  onCancelTask: (task: Task) => Promise<void>;
}) {
  const [activePage, setActivePage] = useState<PersonTaskSecondaryPageId>('all');

  const inProgressTasks = props.personTasks.filter(
    (t) => t.status === 'queued' || t.status === 'running',
  );
  const completedTasks = props.personTasks.filter(
    (t) => t.status === 'succeeded' || t.status === 'failed' || t.status === 'cancelled' || t.status === 'abnormal',
  );

  const renderTaskList = (tasks: Task[]) => {
    if (tasks.length === 0) {
      return <Text style={styles.emptyText}>当前没有符合条件的任务。</Text>;
    }
    return (
      <ExpandableList
        totalCount={tasks.length}
        initialVisibleCount={6}
        renderItems={(expanded) => {
          const visibleTasks = expanded ? tasks : tasks.slice(0, 6);
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
    );
  };

  return (
    <RefreshableScrollView contentContainerStyle={styles.screenContent}>
      <PageSection title="我的任务" description="按任务状态分组查看，点击任务可查看详情，仍可直接取消自己当前排队或运行中的任务。">
        <SecondarySwipeView
          pages={PERSON_TASK_SECONDARY_PAGES}
          activePage={activePage}
          onChangePage={setActivePage}
          renderPage={(page) => (
            <View style={styles.sectionPanel}>
              {page === 'inProgress'
                ? renderTaskList(inProgressTasks)
                : page === 'completed'
                  ? renderTaskList(completedTasks)
                  : renderTaskList(props.personTasks)}
            </View>
          )}
        />
      </PageSection>
    </RefreshableScrollView>
  );
}
