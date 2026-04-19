import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Server, ServerStatus, UnifiedReport } from '@pmeow/app-common';
import { formatPercent, formatTimestamp } from '../app/formatters';
import { computeGpuTotals, formatMemoryGb, formatMemoryPairGb, getUsagePalette, type HostRealtimeHistory, type PerGpuRealtimeHistory } from '../app/metrics';
import { styles } from '../app/styles';
import { QueueTaskRow, SectionCard, StatBlock } from '../components/common';
import { CpuMemoryTrendCard, DiskUsageSection, GpuRealtimeSection, VramDistributionSection } from '../components/monitoring';

export function ServerDetailScreen(props: {
  server: Server;
  status?: ServerStatus;
  report?: UnifiedReport;
  hostRealtimeHistory: HostRealtimeHistory;
  gpuRealtimeHistory: Record<number, PerGpuRealtimeHistory>;
  realtimeHistoryLoading: boolean;
  isAdmin: boolean;
  subscribed: boolean;
  onBack: () => void;
  onToggleSubscription: () => void;
}) {
  const gpuCards = props.report?.resourceSnapshot.gpuCards ?? [];
  const gpuTotals = computeGpuTotals(gpuCards);
  const totalEffectiveFreeMb = gpuCards.reduce((sum, gpu) => sum + gpu.effectiveFreeMb, 0);
  const allocationTasks = [
    ...(props.report?.taskQueue.running ?? []),
    ...(props.report?.taskQueue.queued ?? []),
  ];
  const cpuUsage = props.report?.resourceSnapshot.cpu.usagePercent;
  const memoryUsage = props.report?.resourceSnapshot.memory.usagePercent;
  const gpuPalette = getUsagePalette(gpuTotals.averageUtilization);
  const vramPalette = getUsagePalette(gpuTotals.totalVramPercent);

  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <SectionCard title={props.server.name} description={`Agent ${props.server.agentId.slice(0, 8)} · 最近上报 ${formatTimestamp(props.status?.lastSeenAt ?? null)}`}>
        <View style={styles.summaryGrid}>
          <StatBlock label="状态" value={props.status?.status === 'online' ? '在线' : '离线'} />
          <StatBlock label="运行任务" value={props.report?.taskQueue.running.length ?? 0} />
        </View>
        <View style={styles.summaryGridCompact}>
          <StatBlock label="GPU 总利用率" value={gpuCards.length > 0 ? formatPercent(gpuTotals.averageUtilization) : '无 GPU'} usagePercent={gpuCards.length > 0 ? gpuTotals.averageUtilization : undefined} />
          <StatBlock label="VRAM 占用" value={gpuCards.length > 0 ? formatPercent(gpuTotals.totalVramPercent) : '无 GPU'} usagePercent={gpuCards.length > 0 ? gpuTotals.totalVramPercent : undefined} />
        </View>
        <View style={styles.summaryGridCompact}>
          <StatBlock label="CPU" value={formatPercent(cpuUsage)} usagePercent={cpuUsage} />
          <StatBlock label="内存" value={formatPercent(memoryUsage)} usagePercent={memoryUsage} />
        </View>
        {gpuCards.length > 0 ? (
          <Text style={styles.connectionMeta}>总显存 <Text style={{ color: vramPalette.textColor }}>{formatMemoryPairGb(gpuTotals.totalVramUsedMb, gpuTotals.totalVramMb)}</Text> · 总利用率 <Text style={{ color: gpuPalette.textColor }}>{formatPercent(gpuTotals.averageUtilization)}</Text></Text>
        ) : null}
        {!props.isAdmin ? (
          <Pressable style={styles.secondaryButtonWide} onPress={props.onToggleSubscription}>
            <Text style={styles.secondaryButtonText}>{props.subscribed ? '取消空闲订阅' : '订阅空闲提醒'}</Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.ghostButtonWide} onPress={props.onBack}>
          <Text style={styles.ghostButtonText}>返回</Text>
        </Pressable>
      </SectionCard>

      <SectionCard
        title="资源实时走势"
        description={props.realtimeHistoryLoading ? '正在补齐最近 10 分钟的实时窗口。' : '先看 CPU / 内存总览；GPU 详情默认折叠，展开后查看每张卡的 GPU、VRAM 和显存带宽走势。'}
      >
        {props.report ? (
          <>
            <View style={styles.summaryGrid}>
              <StatBlock label="GPU 数量" value={gpuCards.length} />
              <StatBlock label="调度可用显存" value={formatMemoryGb(totalEffectiveFreeMb)} />
            </View>
            <View style={styles.panelStack}>
              <CpuMemoryTrendCard
                report={props.report}
                history={props.hostRealtimeHistory}
                loading={props.realtimeHistoryLoading}
              />
              <GpuRealtimeSection
                gpuCards={gpuCards}
                gpuRealtimeHistory={props.gpuRealtimeHistory}
                loading={props.realtimeHistoryLoading}
              />
            </View>
          </>
        ) : (
          <Text style={styles.emptyText}>当前节点没有可展示的实时资源指标。</Text>
        )}
      </SectionCard>

      <SectionCard title="磁盘占用" description="低于 60% 绿色，超过 60% 黄色，超过 90% 红色。">
        <DiskUsageSection report={props.report} />
      </SectionCard>

      <SectionCard title="VRAM 分布" description="按托管任务、用户进程、未归属进程和可用显存拆分。">
        <VramDistributionSection gpuCards={gpuCards} tasks={allocationTasks} />
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