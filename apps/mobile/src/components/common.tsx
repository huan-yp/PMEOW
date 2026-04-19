import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Server, ServerStatus, Task, TaskInfo, UnifiedReport } from '@pmeow/app-common';
import type { NotificationInboxItem } from '../lib/notification-inbox';
import {
  formatNotificationKind,
  formatPercent,
  formatQueueTaskStatus,
  formatTaskStatus,
  formatTimestamp,
} from '../app/formatters';
import { getUsagePalette } from '../app/metrics';
import { styles } from '../app/styles';
import { ServerCardVisuals } from './monitoring';

export function SectionCard(props: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{props.title}</Text>
      {props.description ? <Text style={styles.cardDescription}>{props.description}</Text> : null}
      {props.children}
    </View>
  );
}

export function StatBlock(props: { label: string; value: string | number; usagePercent?: number }) {
  const palette = props.usagePercent == null ? null : getUsagePalette(props.usagePercent);

  return (
    <View
      style={[
        styles.summaryBlock,
        palette ? { borderColor: palette.borderColor, backgroundColor: palette.backgroundColor } : null,
      ]}
    >
      <Text style={[styles.summaryValue, palette ? { color: palette.textColor } : null]}>{props.value}</Text>
      <Text style={styles.summaryLabel}>{props.label}</Text>
    </View>
  );
}

export function ServerCard(props: {
  server: Server;
  status?: ServerStatus;
  report?: UnifiedReport;
  onPress?: () => void;
}) {
  const connStatus = props.status?.status ?? 'offline';
  const runningCount = props.report?.taskQueue.running.length ?? 0;
  const queuedCount = props.report?.taskQueue.queued.length ?? 0;
  const cpuPalette = getUsagePalette(props.report?.resourceSnapshot.cpu.usagePercent);
  const memoryPalette = getUsagePalette(props.report?.resourceSnapshot.memory.usagePercent);

  return (
    <Pressable style={styles.serverCard} onPress={props.onPress}>
      <View style={styles.serverHeader}>
        <Text style={styles.serverTitle}>{props.server.name}</Text>
        <View style={[styles.statusBadge, connStatus === 'online' ? styles.statusOnline : styles.statusOffline]}>
          <Text style={styles.statusBadgeText}>{connStatus === 'online' ? '在线' : '离线'}</Text>
        </View>
      </View>
      <Text style={styles.serverMeta}>Agent {props.server.agentId.slice(0, 8)} · 最近上报 {formatTimestamp(props.status?.lastSeenAt ?? null)}</Text>
      <View style={styles.metricRow}>
        <Text style={[styles.metricItem, { color: cpuPalette.textColor, borderColor: cpuPalette.borderColor, backgroundColor: cpuPalette.backgroundColor }]}>CPU {formatPercent(props.report?.resourceSnapshot.cpu.usagePercent)}</Text>
        <Text style={[styles.metricItem, { color: memoryPalette.textColor, borderColor: memoryPalette.borderColor, backgroundColor: memoryPalette.backgroundColor }]}>内存 {formatPercent(props.report?.resourceSnapshot.memory.usagePercent)}</Text>
        <Text style={styles.metricItem}>运行 {runningCount}</Text>
        <Text style={styles.metricItem}>排队 {queuedCount}</Text>
      </View>
      <ServerCardVisuals report={props.report} />
    </Pressable>
  );
}

export function TaskRow(props: {
  task: Task;
  pending: boolean;
  onCancel?: () => void;
}) {
  const cancellable = props.task.status === 'queued' || props.task.status === 'running';

  return (
    <View style={styles.eventRow}>
      <View style={styles.rowHeader}>
        <Text style={styles.eventTitle}>{formatTaskStatus(props.task.status)} · {props.task.command}</Text>
        {cancellable && props.onCancel ? (
          <Pressable
            style={[styles.inlineActionButton, props.pending ? styles.buttonDisabled : null]}
            disabled={props.pending}
            onPress={props.onCancel}
          >
            <Text style={styles.inlineActionButtonText}>{props.pending ? '处理中...' : '取消'}</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.eventMeta}>{props.task.serverId} · {props.task.user} · {formatTimestamp(props.task.createdAt)}</Text>
    </View>
  );
}

export function QueueTaskRow(props: { task: TaskInfo }) {
  return (
    <View style={styles.eventRow}>
      <Text style={styles.eventTitle}>{formatQueueTaskStatus(props.task.status)} · {props.task.command}</Text>
      <Text style={styles.eventMeta}>{props.task.user} · VRAM {props.task.requireVramMb}MB · {formatTimestamp(props.task.createdAt)}</Text>
    </View>
  );
}

export function NotificationInboxSection(props: { items: NotificationInboxItem[] }) {
  return (
    <SectionCard title="通知记录" description="仅展示本机真正发送过的系统通知。">
      {props.items.length === 0 ? (
        <Text style={styles.emptyText}>当前还没有本地通知记录。</Text>
      ) : (
        props.items.map((item) => (
          <View key={item.id} style={styles.eventRow}>
            <Text style={styles.eventTitle}>{formatNotificationKind(item.kind)} · {item.title}</Text>
            <Text style={styles.eventMeta}>{item.body} · {formatTimestamp(item.timestamp)}</Text>
          </View>
        ))
      )}
    </SectionCard>
  );
}

export function BottomTabs<T extends string>(props: {
  tabs: Array<{ id: T; label: string }>;
  activeTab: T;
  onChangeTab: (tab: T) => void;
}) {
  return (
    <View style={styles.bottomTabs}>
      {props.tabs.map((tab) => {
        const active = tab.id === props.activeTab;
        return (
          <Pressable
            key={tab.id}
            style={[styles.bottomTab, active ? styles.bottomTabActive : null]}
            onPress={() => props.onChangeTab(tab.id)}
          >
            <Text style={[styles.bottomTabText, active ? styles.bottomTabTextActive : null]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function AuthenticatedShell(props: {
  title: string;
  subtitle: string;
  error: string | null;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  children: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <View style={styles.shell}>
      <View style={styles.shellHeader}>
        <View style={styles.heroCompact}>
          <Text style={styles.kicker}>PMEOW MOBILE</Text>
          <Text style={styles.shellTitle}>{props.title}</Text>
          <Text style={styles.shellSubtitle}>{props.subtitle}</Text>
          {props.error ? <Text style={styles.errorText}>{props.error}</Text> : null}
        </View>
        <Pressable style={styles.refreshButton} onPress={() => void props.onRefresh()}>
          <Text style={styles.refreshButtonText}>{props.refreshing ? '刷新中...' : '刷新'}</Text>
        </Pressable>
      </View>
      <View style={styles.screenWrap}>{props.children}</View>
      {props.tabs}
    </View>
  );
}