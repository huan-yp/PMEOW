import { useEffect, useState } from 'react';
import { BackHandler, Pressable, ScrollView, Text, View } from 'react-native';
import type { Task } from '@pmeow/app-common';
import {
  formatTaskDetailValue,
  formatTaskStatus,
  formatTimestamp,
} from '../app/formatters';
import { styles } from '../app/styles';
import { SectionCard } from '../components/common';
import { formatMobileApiError, MobileApiClient, MobileApiError } from '../lib/api';

function isTaskCancelable(task: Task | null): boolean {
  return task?.status === 'queued' || task?.status === 'running';
}

function formatTaskIdentifier(taskId: string): string {
  return taskId.length > 12 ? taskId.slice(0, 12) : taskId;
}

function formatTaskDetailError(error: unknown): string {
  if (error instanceof MobileApiError && (error.status === 403 || error.status === 404)) {
    return '任务详情不可用。';
  }
  return formatMobileApiError(error);
}

function formatRequestedResources(task: Task): string {
  return `${task.requireVramMb} MB × ${task.requireGpuCount} GPU`;
}

function formatGpuList(values: number[] | null): string {
  if (!values || values.length === 0) {
    return '—';
  }
  return values.join(', ');
}

function DetailField(props: { label: string; value: string | number | null | undefined }) {
  return (
    <View style={styles.detailPanel}>
      <Text style={styles.detailPanelMeta}>{props.label}</Text>
      <Text style={styles.detailPanelTitle}>{formatTaskDetailValue(props.value)}</Text>
    </View>
  );
}

export function PersonTaskDetailScreen(props: {
  taskId: string;
  baseUrl: string;
  authToken: string | null;
  refreshNonce: number;
  onBack: () => void;
  onRefreshOverview: () => Promise<void>;
}) {
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingCancel, setPendingCancel] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshTask = async () => {
    if (!props.authToken || !props.baseUrl) {
      setTask(null);
      setLoading(false);
      setError('任务详情不可用。');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const client = new MobileApiClient(props.baseUrl, props.authToken);
      const nextTask = await client.getTask(props.taskId);
      setTask(nextTask);
    } catch (nextError) {
      setTask(null);
      setError(formatTaskDetailError(nextError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      props.onBack();
      return true;
    });

    return () => {
      subscription.remove();
    };
  }, [props.onBack]);

  useEffect(() => {
    void refreshTask();
  }, [props.authToken, props.baseUrl, props.refreshNonce, props.taskId]);

  const handleCancelTask = async () => {
    if (!task || !props.authToken || !props.baseUrl) {
      return;
    }

    setPendingCancel(true);
    setNotice(null);
    setError(null);

    try {
      const client = new MobileApiClient(props.baseUrl, props.authToken);
      await client.cancelTask(task.serverId, task.id);
      setNotice('已提交取消请求。');
      await Promise.all([props.onRefreshOverview(), refreshTask()]);
    } catch (nextError) {
      setError(formatTaskDetailError(nextError));
    } finally {
      setPendingCancel(false);
    }
  };

  const summaryText = loading
    ? '正在加载任务详情...'
    : task
      ? `${formatTaskStatus(task.status)} · ${formatTaskIdentifier(task.id)}`
      : `任务 ID · ${formatTaskIdentifier(props.taskId)}`;

  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <SectionCard title="任务详情" description={summaryText}>
        <Pressable
          style={{
            alignSelf: 'flex-start',
            borderRadius: 999,
            paddingHorizontal: 12,
            paddingVertical: 8,
            backgroundColor: '#102638',
          }}
          onPress={props.onBack}
        >
          <Text style={{ color: '#dce9f4', fontSize: 12, fontWeight: '700' }}>← 返回我的任务</Text>
        </Pressable>
        {notice ? <Text style={{ marginTop: 12, color: '#7fd9aa', fontSize: 14, lineHeight: 21 }}>{notice}</Text> : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {loading ? <Text style={styles.emptyText}>加载中...</Text> : null}
        {!loading && !error ? <Text style={styles.connectionMeta}>任务 ID：{props.taskId}</Text> : null}
      </SectionCard>

      {!loading && !task ? (
        <SectionCard title="无法显示详情" description="该记录可能已不存在或当前账号无权查看。">
          <Pressable style={styles.secondaryButtonWide} onPress={() => void refreshTask()}>
            <Text style={styles.secondaryButtonText}>重试</Text>
          </Pressable>
          <Pressable style={styles.ghostButtonWide} onPress={props.onBack}>
            <Text style={styles.ghostButtonText}>返回</Text>
          </Pressable>
        </SectionCard>
      ) : null}

      {!loading && task ? (
        <>
          <SectionCard title="主要信息" description="先看任务是什么、当前在哪台机器上。">
            <View style={styles.panelStack}>
              <DetailField label="命令" value={task.command} />
              <DetailField label="服务器" value={task.serverId} />
              <DetailField label="用户" value={task.user} />
              <DetailField label="创建时间" value={formatTimestamp(task.createdAt)} />
            </View>
          </SectionCard>

          <SectionCard title="资源与启动信息" description="保留 web 端里最常用的调度和启动信息。">
            <View style={styles.panelStack}>
              <DetailField label="状态" value={formatTaskStatus(task.status)} />
              <DetailField label="请求资源" value={formatRequestedResources(task)} />
              <DetailField label="启动模式" value={task.launchMode} />
              <DetailField label="优先级" value={task.priority} />
              <DetailField label="指定 GPU" value={formatGpuList(task.gpuIds)} />
            </View>
          </SectionCard>

          <SectionCard title="运行状态信息" description="排查任务为什么没有启动或为什么结束。">
            <View style={styles.panelStack}>
              <DetailField label="工作目录" value={task.cwd} />
              <DetailField label="开始时间" value={task.startedAt ? formatTimestamp(task.startedAt) : null} />
              <DetailField label="结束时间" value={task.finishedAt ? formatTimestamp(task.finishedAt) : null} />
              <DetailField label="PID" value={task.pid} />
              <DetailField label="退出码" value={task.exitCode} />
              <DetailField label="结束原因" value={task.endReason} />
            </View>
          </SectionCard>

          {task.assignedGpus && task.assignedGpus.length > 0 ? (
            <SectionCard title="已分配 GPU" description="任务已经占用的显卡列表。">
              <View style={styles.panelStack}>
                <DetailField label="GPU 列表" value={formatGpuList(task.assignedGpus)} />
                <DetailField label="每 GPU 声明显存" value={task.declaredVramPerGpu == null ? null : `${task.declaredVramPerGpu} MB`} />
              </View>
            </SectionCard>
          ) : null}

          {isTaskCancelable(task) ? (
            <SectionCard title="操作" description="只能取消当前仍在排队或运行中的任务。">
              <Pressable
                style={[styles.primaryButton, pendingCancel ? styles.buttonDisabled : null]}
                disabled={pendingCancel}
                onPress={() => void handleCancelTask()}
              >
                <Text style={styles.primaryButtonText}>{pendingCancel ? '提交中...' : '取消任务'}</Text>
              </Pressable>
            </SectionCard>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
