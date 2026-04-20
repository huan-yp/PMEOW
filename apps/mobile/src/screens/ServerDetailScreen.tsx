import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { Server, ServerStatus, UnifiedReport } from '@pmeow/app-common';
import { formatPercent, formatTimestamp } from '../app/formatters';
import { computeGpuTotals, formatMemoryGb, formatMemoryPairGb, getUsagePalette, type HostRealtimeHistory, type PerGpuRealtimeHistory } from '../app/metrics';
import { styles } from '../app/styles';
import { ExpandableList, QueueTaskRow, SectionCard, StatBlock } from '../components/common';
import { DEFAULT_IDLE_GPU_NOTIFICATION_RULE, type IdleGpuNotificationRule } from '../lib/preferences';
import { CpuMemoryTrendCard, DiskUsageSection, GpuRealtimeSection, VramDistributionSection } from '../components/monitoring';

function buildEditableRule(rule: IdleGpuNotificationRule | null): {
  minIdleGpuCount: string;
  idleWindowSeconds: string;
  maxGpuUtilizationPercent: string;
  minSchedulableFreePercent: string;
} {
  const effective = rule ?? DEFAULT_IDLE_GPU_NOTIFICATION_RULE;
  return {
    minIdleGpuCount: String(effective.minIdleGpuCount),
    idleWindowSeconds: String(effective.idleWindowSeconds),
    maxGpuUtilizationPercent: String(effective.maxGpuUtilizationPercent),
    minSchedulableFreePercent: String(effective.minSchedulableFreePercent),
  };
}

function parseRuleNumber(value: string, min: number, max: number): number | null {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.min(max, Math.max(min, Math.round(parsed * 10) / 10));
}

export function ServerDetailScreen(props: {
  server: Server;
  status?: ServerStatus;
  report?: UnifiedReport;
  hostRealtimeHistory: HostRealtimeHistory;
  gpuRealtimeHistory: Record<number, PerGpuRealtimeHistory>;
  realtimeHistoryLoading: boolean;
  isAdmin: boolean;
  subscribed: boolean;
  subscriptionRule: IdleGpuNotificationRule | null;
  onBack: () => void;
  onToggleSubscription: () => void;
  onSaveSubscriptionRule: (rule: IdleGpuNotificationRule) => void;
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
  const [editableRule, setEditableRule] = useState(() => buildEditableRule(props.subscriptionRule));
  const [ruleError, setRuleError] = useState<string | null>(null);

  useEffect(() => {
    setEditableRule(buildEditableRule(props.subscriptionRule));
    setRuleError(null);
  }, [props.server.id, props.subscriptionRule]);

  const currentRule = useMemo(() => {
    return props.subscriptionRule ?? DEFAULT_IDLE_GPU_NOTIFICATION_RULE;
  }, [props.subscriptionRule]);

  const canConfigureGpuIdle = gpuCards.length > 0;

  const saveRule = () => {
    const minIdleGpuCount = parseRuleNumber(editableRule.minIdleGpuCount, 1, 16);
    const idleWindowSeconds = parseRuleNumber(editableRule.idleWindowSeconds, 10, 3600);
    const maxGpuUtilizationPercent = parseRuleNumber(editableRule.maxGpuUtilizationPercent, 0, 100);
    const minSchedulableFreePercent = parseRuleNumber(editableRule.minSchedulableFreePercent, 0, 100);

    if (
      minIdleGpuCount == null
      || idleWindowSeconds == null
      || maxGpuUtilizationPercent == null
      || minSchedulableFreePercent == null
    ) {
      setRuleError('四个字段都需要填写有效数字。');
      return;
    }
    if (gpuCards.length > 0 && minIdleGpuCount > gpuCards.length) {
      setRuleError(`当前机器只有 ${gpuCards.length} 张 GPU，最少空闲 GPU 数不能更高。`);
      return;
    }

    setRuleError(null);
    props.onSaveSubscriptionRule({
      minIdleGpuCount: Math.round(minIdleGpuCount),
      idleWindowSeconds: Math.round(idleWindowSeconds),
      maxGpuUtilizationPercent,
      minSchedulableFreePercent,
    });
  };

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
          canConfigureGpuIdle ? (
            <>
              <Pressable style={styles.secondaryButtonWide} onPress={props.onToggleSubscription}>
                <Text style={styles.secondaryButtonText}>{props.subscribed ? '取消 GPU 空闲订阅' : '订阅 GPU 空闲提醒'}</Text>
              </Pressable>
              {props.subscribed ? (
                <View style={styles.ruleEditorCard}>
                  <Text style={styles.preferenceTitle}>订阅规则</Text>
                  <Text style={styles.preferenceBody}>同机只在重新离开并再次满足规则后再提醒；全局 15 分钟内最多发 1 条。</Text>
                  <Text style={styles.connectionMeta}>当前规则：至少 {currentRule.minIdleGpuCount} 张 GPU 在最近 {currentRule.idleWindowSeconds} 秒内利用率低于 {currentRule.maxGpuUtilizationPercent}% 且调度可用显存高于 {currentRule.minSchedulableFreePercent}%。</Text>
                  <View style={styles.ruleInputRow}>
                    <View style={styles.ruleInputCell}>
                      <Text style={styles.fieldLabel}>最少空闲 GPU 数</Text>
                      <TextInput
                        keyboardType="numeric"
                        placeholder="1"
                        placeholderTextColor="#60758a"
                        style={styles.input}
                        value={editableRule.minIdleGpuCount}
                        onChangeText={(value) => setEditableRule((current) => ({ ...current, minIdleGpuCount: value }))}
                      />
                    </View>
                    <View style={styles.ruleInputCell}>
                      <Text style={styles.fieldLabel}>观测窗口秒数</Text>
                      <TextInput
                        keyboardType="numeric"
                        placeholder="60"
                        placeholderTextColor="#60758a"
                        style={styles.input}
                        value={editableRule.idleWindowSeconds}
                        onChangeText={(value) => setEditableRule((current) => ({ ...current, idleWindowSeconds: value }))}
                      />
                    </View>
                  </View>
                  <View style={styles.ruleInputRow}>
                    <View style={styles.ruleInputCell}>
                      <Text style={styles.fieldLabel}>GPU 利用率上限 %</Text>
                      <TextInput
                        keyboardType="numeric"
                        placeholder="5"
                        placeholderTextColor="#60758a"
                        style={styles.input}
                        value={editableRule.maxGpuUtilizationPercent}
                        onChangeText={(value) => setEditableRule((current) => ({ ...current, maxGpuUtilizationPercent: value }))}
                      />
                    </View>
                    <View style={styles.ruleInputCell}>
                      <Text style={styles.fieldLabel}>调度可用显存下限 %</Text>
                      <TextInput
                        keyboardType="numeric"
                        placeholder="80"
                        placeholderTextColor="#60758a"
                        style={styles.input}
                        value={editableRule.minSchedulableFreePercent}
                        onChangeText={(value) => setEditableRule((current) => ({ ...current, minSchedulableFreePercent: value }))}
                      />
                    </View>
                  </View>
                  {ruleError ? <Text style={styles.errorText}>{ruleError}</Text> : null}
                  <Pressable style={styles.primaryButton} onPress={saveRule}>
                    <Text style={styles.primaryButtonText}>保存订阅规则</Text>
                  </Pressable>
                </View>
              ) : null}
            </>
          ) : (
            <Text style={styles.connectionMeta}>当前机器没有 GPU，无法配置 GPU 空闲提醒。</Text>
          )
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
          <ExpandableList
            totalCount={props.report?.taskQueue.running.length ?? 0}
            initialVisibleCount={5}
            renderItems={(expanded) => {
              const visibleTasks = expanded
                ? props.report?.taskQueue.running ?? []
                : props.report?.taskQueue.running.slice(0, 5) ?? [];

              return visibleTasks.map((task) => <QueueTaskRow key={task.taskId} task={task} />);
            }}
          />
        )}
      </SectionCard>

      <SectionCard title="排队任务">
        {(props.report?.taskQueue.queued.length ?? 0) === 0 ? (
          <Text style={styles.emptyText}>当前没有排队任务。</Text>
        ) : (
          <ExpandableList
            totalCount={props.report?.taskQueue.queued.length ?? 0}
            initialVisibleCount={5}
            renderItems={(expanded) => {
              const visibleTasks = expanded
                ? props.report?.taskQueue.queued ?? []
                : props.report?.taskQueue.queued.slice(0, 5) ?? [];

              return visibleTasks.map((task) => <QueueTaskRow key={task.taskId} task={task} />);
            }}
          />
        )}
      </SectionCard>

      <SectionCard title="最近结束任务">
        {(props.report?.taskQueue.recentlyEnded.length ?? 0) === 0 ? (
          <Text style={styles.emptyText}>当前没有最近结束的任务。</Text>
        ) : (
          <ExpandableList
            totalCount={props.report?.taskQueue.recentlyEnded.length ?? 0}
            initialVisibleCount={5}
            renderItems={(expanded) => {
              const visibleTasks = expanded
                ? props.report?.taskQueue.recentlyEnded ?? []
                : props.report?.taskQueue.recentlyEnded.slice(0, 5) ?? [];

              return visibleTasks.map((task) => <QueueTaskRow key={task.taskId} task={task} />);
            }}
          />
        )}
      </SectionCard>
    </ScrollView>
  );
}