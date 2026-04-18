import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Server, ServerStatus, UnifiedReport } from '@monitor/app-common';
import { formatPercent, formatTimestamp } from '../app/formatters';
import { styles } from '../app/styles';
import { QueueTaskRow, SectionCard, StatBlock } from '../components/common';

export function ServerDetailScreen(props: {
  server: Server;
  status?: ServerStatus;
  report?: UnifiedReport;
  isAdmin: boolean;
  subscribed: boolean;
  onBack: () => void;
  onToggleSubscription: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <SectionCard title={props.server.name} description={`Agent ${props.server.agentId.slice(0, 8)} · 最近上报 ${formatTimestamp(props.status?.lastSeenAt ?? null)}`}>
        <View style={styles.summaryGrid}>
          <StatBlock label="状态" value={props.status?.status === 'online' ? '在线' : '离线'} />
          <StatBlock label="运行任务" value={props.report?.taskQueue.running.length ?? 0} />
        </View>
        <View style={styles.summaryGridCompact}>
          <StatBlock label="CPU" value={formatPercent(props.report?.resourceSnapshot.cpu.usagePercent)} />
          <StatBlock label="内存" value={formatPercent(props.report?.resourceSnapshot.memory.usagePercent)} />
        </View>
        {!props.isAdmin ? (
          <Pressable style={styles.secondaryButtonWide} onPress={props.onToggleSubscription}>
            <Text style={styles.secondaryButtonText}>{props.subscribed ? '取消空闲订阅' : '订阅空闲提醒'}</Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.ghostButtonWide} onPress={props.onBack}>
          <Text style={styles.ghostButtonText}>返回</Text>
        </Pressable>
      </SectionCard>

      <SectionCard title="运行中任务">
        {(props.report?.taskQueue.running.length ?? 0) === 0 ? (
          <Text style={styles.emptyText}>当前没有运行中的任务。</Text>
        ) : (
          props.report?.taskQueue.running.map((task) => <QueueTaskRow key={task.taskId} task={task} />)
        )}
      </SectionCard>

      <SectionCard title="排队任务">
        {(props.report?.taskQueue.queued.length ?? 0) === 0 ? (
          <Text style={styles.emptyText}>当前没有排队任务。</Text>
        ) : (
          props.report?.taskQueue.queued.map((task) => <QueueTaskRow key={task.taskId} task={task} />)
        )}
      </SectionCard>

      <SectionCard title="最近结束任务">
        {(props.report?.taskQueue.recentlyEnded.length ?? 0) === 0 ? (
          <Text style={styles.emptyText}>当前没有最近结束的任务。</Text>
        ) : (
          props.report?.taskQueue.recentlyEnded.map((task) => <QueueTaskRow key={task.taskId} task={task} />)
        )}
      </SectionCard>
    </ScrollView>
  );
}