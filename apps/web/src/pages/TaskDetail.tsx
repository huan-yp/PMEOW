import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTransport } from '../transport/TransportProvider.js';
import type { ScheduleEvaluation, Task } from '../transport/types.js';
import {
  formatAutoReclaimStatus,
  formatPerGpuReclaimMap,
  formatPerGpuVramMap,
  formatTaskRequestedResources,
  formatVramGB,
} from '../utils/vram.js';
import { useStore } from '../store/useStore.js';

export default function TaskDetail() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const transport = useTransport();
  const servers = useStore((state) => state.servers);
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!taskId) return;
    setLoading(true);
    transport.getTask(taskId)
      .then(setTask)
      .catch(() => setTask(null))
      .finally(() => setLoading(false));
  }, [taskId, transport]);

  if (loading) return <div className="p-8 text-center text-slate-500">加载中...</div>;
  if (!task) return <div className="p-8 text-center text-slate-500">任务不存在。<button onClick={() => navigate('/tasks')} className="ml-2 text-accent-blue hover:underline">返回列表</button></div>;

  const statusLabels: Record<string, string> = { queued: '排队中', running: '运行中', succeeded: '已完成', failed: '失败', cancelled: '已取消', abnormal: '异常结束' };
  const server = servers.find((item) => item.id === task.serverId);
  const serverName = server?.name ?? task.serverName;

  return (
    <div className="space-y-6">
      <div>
        <button onClick={() => navigate('/tasks')} className="text-xs text-accent-blue hover:underline mb-2">← 返回任务列表</button>
        <h2 className="text-xl font-bold text-slate-100">任务详情</h2>
        <p className="mt-1 font-mono text-sm text-slate-400">{task.id}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <InfoCard label="命令" value={task.command} />
        <InfoCard label="工作目录" value={task.cwd} />
        <InfoCard label="用户" value={task.user} />
        <MachineInfoCard
          serverId={task.serverId}
          serverName={serverName}
          onOpen={() => navigate(`/nodes/${task.serverId}`, {
            state: {
              returnTo: `/tasks/${task.id}`,
              returnLabel: '返回任务详情',
            },
          })}
        />
        <InfoCard label="状态" value={statusLabels[task.status] ?? task.status} />
        <InfoCard label="启动模式" value={task.launchMode} />
        <InfoCard label="优先级" value={String(task.priority)} />
        <InfoCard
          label="请求 VRAM"
          value={formatTaskRequestedResources(task)}
        />
        <InfoCard label="VRAM 模式" value={task.vramMode} />
        <InfoCard label="观察窗口" value={task.autoObserveWindowSec ? `${task.autoObserveWindowSec} 秒` : '—'} />
        <InfoCard label="观察峰值" value={formatPerGpuVramMap(task.autoPeakVramByGpuMb)} />
        <InfoCard label="回收状态" value={formatAutoReclaimStatus(task)} />
        <InfoCard label="回收后预留" value={formatPerGpuReclaimMap(task.autoReclaimedVramByGpuMb)} />
        <InfoCard label="PID" value={task.pid ? String(task.pid) : '—'} />
        <InfoCard label="退出码" value={task.exitCode !== null ? String(task.exitCode) : '—'} />
        <InfoCard label="结束原因" value={task.endReason ?? '—'} />
        <InfoCard label="创建时间" value={new Date(task.createdAt * 1000).toLocaleString('zh-CN')} />
        <InfoCard label="开始时间" value={task.startedAt ? new Date(task.startedAt * 1000).toLocaleString('zh-CN') : '—'} />
        <InfoCard label="结束时间" value={task.finishedAt ? new Date(task.finishedAt * 1000).toLocaleString('zh-CN') : '—'} />
      </div>

      {task.assignedGpus && (
        <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
          <h3 className="mb-2 text-sm font-medium text-slate-300">分配的 GPU</h3>
          <p className="font-mono text-sm text-slate-200">{task.assignedGpus.join(', ')}</p>
          {task.declaredVramPerGpu && <p className="mt-1 text-xs text-slate-500">每 GPU 声明 {task.declaredVramPerGpu} MB VRAM</p>}
        </div>
      )}

      {task.scheduleHistory && task.scheduleHistory.length > 0 && (
        <div className="rounded-2xl border border-dark-border bg-dark-card p-4">
          <h3 className="mb-3 text-sm font-medium text-slate-300">调度历史</h3>
          <div className="space-y-2">
            {task.scheduleHistory.map((entry, i) => (
              <ScheduleHistoryCard
                key={i}
                entry={entry}
                fallbackRequestedGpuCount={task.requireGpuCount}
                fallbackRequestedVramMb={task.requireVramMb}
                fallbackVramMode={task.vramMode}
              />
            ))}
          </div>
        </div>
      )}

      {(task.status === 'queued' || task.status === 'running') && (
        <div className="flex gap-3">
          <button
            onClick={async () => {
              try { await transport.cancelTask(task.serverId, task.id); navigate('/tasks'); } catch { /* ignore */ }
            }}
            className="rounded-lg bg-accent-red px-4 py-2 text-sm text-white hover:bg-accent-red/80"
          >
            取消任务
          </button>
        </div>
      )}
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-mono text-slate-200 break-all">{value}</p>
    </div>
  );
}

function MachineInfoCard({
  serverId,
  serverName,
  onOpen,
}: {
  serverId: string;
  serverName?: string;
  onOpen: () => void;
}) {
  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-3">
      <p className="text-xs text-slate-500">来源机器</p>
      <button onClick={onOpen} className="mt-1 text-left text-sm font-medium text-accent-blue hover:underline">
        {serverName ?? serverId}
      </button>
      {serverName && <p className="mt-1 text-xs font-mono text-slate-500 break-all">{serverId}</p>}
    </div>
  );
}

function ScheduleHistoryCard({
  entry,
  fallbackRequestedGpuCount,
  fallbackRequestedVramMb,
  fallbackVramMode,
}: {
  entry: ScheduleEvaluation;
  fallbackRequestedGpuCount: number;
  fallbackRequestedVramMb: number;
  fallbackVramMode: 'exclusive_auto' | 'shared';
}) {
  const selectedGpuIds = parseGpuIdList(entry.detail, 'selected');
  const eligibleGpuIds = parseGpuIdList(entry.detail, 'eligible_now');
  const sustainedGpuIds = parseGpuIdList(entry.detail, 'sustained_common');
  const effectiveFree = extractEffectiveFreeSnapshot(entry.gpuSnapshot);
  const requestedGpuCount = getSnapshotNumber(entry.gpuSnapshot, 'requestedGpuCount') ?? fallbackRequestedGpuCount;
  const requestedVramMb = getSnapshotNumber(entry.gpuSnapshot, 'requestedVramMb') ?? fallbackRequestedVramMb;
  const vramMode = getSnapshotVramMode(entry.gpuSnapshot, 'vramMode') ?? fallbackVramMode;
  const selectedGpuCount = getSnapshotNumber(entry.gpuSnapshot, 'selectedGpuCount') ?? selectedGpuIds.length;
  const eligibleNowCount = getSnapshotNumber(entry.gpuSnapshot, 'eligibleNowCount') ?? eligibleGpuIds.length;
  const eligibleSustainedCount = getSnapshotNumber(entry.gpuSnapshot, 'eligibleSustainedCount') ?? sustainedGpuIds.length;
  const maxBarMb = Math.max(requestedVramMb, ...effectiveFree.map((gpu) => gpu.freeMb), 1);
  const thresholdPercent = Math.min((requestedVramMb / maxBarMb) * 100, 100);

  return (
    <div className="rounded-xl border border-dark-border/60 bg-dark-bg/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${getResultBadgeClassName(entry.result)}`}>
            {formatScheduleResult(entry.result)}
          </span>
          <span className="text-xs text-slate-500">
            {new Date(entry.timestamp * 1000).toLocaleString('zh-CN')}
          </span>
        </div>
        <div className="text-xs text-slate-400">
          {vramMode === 'exclusive_auto'
            ? `需要 ${requestedGpuCount} 张 GPU，独占（自动观察）`
            : `需要 ${requestedGpuCount} 张 GPU，每张至少 ${formatVramGB(requestedVramMb)}（共享）`}
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <DecisionSummaryStat label="当前满足" value={`${eligibleNowCount} 张`} />
        <DecisionSummaryStat label="持续满足" value={`${eligibleSustainedCount} 张`} />
        <DecisionSummaryStat label="实际选中" value={`${selectedGpuCount} 张`} />
      </div>

      {effectiveFree.length > 0 ? (
        <div className="mt-4 space-y-3">
          {effectiveFree.map((gpu) => {
            const fillPercent = Math.min((gpu.freeMb / maxBarMb) * 100, 100);
            const state = resolveGpuDecisionState(gpu.gpuId, selectedGpuIds, eligibleGpuIds, sustainedGpuIds, gpu.freeMb >= requestedVramMb);
            return (
              <div key={gpu.gpuId} className="rounded-lg border border-dark-border/50 bg-dark-card/70 p-3">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-slate-200">GPU {gpu.gpuId}</span>
                    <span className={`rounded-full px-2 py-0.5 ${getStateBadgeClassName(state.kind)}`}>
                      {state.label}
                    </span>
                  </div>
                  <span className="text-slate-400">{formatVramGB(gpu.freeMb)} 可用</span>
                </div>
                <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="absolute inset-y-0 border-l border-dashed border-slate-300/70"
                    style={{ left: `${thresholdPercent}%` }}
                    aria-hidden="true"
                  />
                  <div
                    className={`h-full rounded-full ${getBarClassName(state.kind, gpu.freeMb >= requestedVramMb)}`}
                    style={{ width: `${fillPercent}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                  <span>阈值 {formatVramGB(requestedVramMb)}</span>
                  <span>effective free {formatVramGB(gpu.freeMb)}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function DecisionSummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-dark-border/50 bg-dark-card/60 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-slate-200">{value}</div>
    </div>
  );
}

function formatScheduleResult(result: ScheduleEvaluation['result']): string {
  switch (result) {
    case 'scheduled':
      return '已调度';
    case 'blocked_by_priority':
      return '被高优先级占用';
    case 'sustained_window_not_met':
      return '未通过持续窗口';
    case 'insufficient_gpu':
    default:
      return '当前 GPU 不足';
  }
}

function getResultBadgeClassName(result: ScheduleEvaluation['result']): string {
  switch (result) {
    case 'scheduled':
      return 'bg-emerald-500/15 text-emerald-300';
    case 'blocked_by_priority':
      return 'bg-amber-500/15 text-amber-300';
    case 'sustained_window_not_met':
      return 'bg-sky-500/15 text-sky-300';
    case 'insufficient_gpu':
    default:
      return 'bg-rose-500/15 text-rose-300';
  }
}

function parseGpuIdList(detail: string, key: string): number[] {
  const pattern = new RegExp(`${key}=([^;]+)`);
  const match = detail.match(pattern);
  if (!match) return [];
  const rawValue = match[1]?.trim().toLowerCase();
  if (!rawValue || rawValue === 'none') return [];
  return rawValue
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value));
}

function getSnapshotNumber(snapshot: Record<string, unknown>, key: string): number | null {
  const value = snapshot[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getSnapshotVramMode(snapshot: Record<string, unknown>, key: string): 'exclusive_auto' | 'shared' | null {
  const value = snapshot[key];
  return value === 'exclusive_auto' || value === 'shared' ? value : null;
}

function extractEffectiveFreeSnapshot(snapshot: Record<string, unknown>) {
  return Object.entries(snapshot)
    .filter(([key, value]) => key.startsWith('effectiveFreeMb.gpu') && typeof value === 'number' && Number.isFinite(value))
    .map(([key, value]) => ({
      gpuId: Number.parseInt(key.replace('effectiveFreeMb.gpu', ''), 10),
      freeMb: value as number,
    }))
    .filter((item) => Number.isInteger(item.gpuId))
    .sort((left, right) => left.gpuId - right.gpuId);
}


function resolveGpuDecisionState(
  gpuId: number,
  selectedGpuIds: number[],
  eligibleGpuIds: number[],
  sustainedGpuIds: number[],
  meetsThreshold: boolean,
): { kind: 'selected' | 'eligible' | 'sustained' | 'insufficient'; label: string } {
  if (selectedGpuIds.includes(gpuId)) {
    return { kind: 'selected', label: '已选中' };
  }
  if (eligibleGpuIds.includes(gpuId) && sustainedGpuIds.includes(gpuId)) {
    return { kind: 'eligible', label: '当前与持续满足' };
  }
  if (eligibleGpuIds.includes(gpuId)) {
    return { kind: 'eligible', label: '当前满足' };
  }
  if (sustainedGpuIds.includes(gpuId)) {
    return { kind: 'sustained', label: '持续满足' };
  }
  return { kind: 'insufficient', label: meetsThreshold ? '未入选' : '低于阈值' };
}

function getStateBadgeClassName(kind: 'selected' | 'eligible' | 'sustained' | 'insufficient'): string {
  switch (kind) {
    case 'selected':
      return 'bg-emerald-500/15 text-emerald-300';
    case 'eligible':
      return 'bg-sky-500/15 text-sky-300';
    case 'sustained':
      return 'bg-violet-500/15 text-violet-300';
    case 'insufficient':
    default:
      return 'bg-slate-700 text-slate-300';
  }
}

function getBarClassName(kind: 'selected' | 'eligible' | 'sustained' | 'insufficient', meetsThreshold: boolean): string {
  if (kind === 'selected') return 'bg-emerald-400';
  if (kind === 'eligible') return 'bg-sky-400';
  if (kind === 'sustained') return 'bg-violet-400';
  return meetsThreshold ? 'bg-slate-500' : 'bg-rose-400';
}
