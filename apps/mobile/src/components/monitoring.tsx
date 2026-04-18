import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Polyline } from 'react-native-svg';
import type { GpuCardReport, TaskInfo, UnifiedReport } from '@monitor/app-common';
import { formatPercent } from '../app/formatters';
import {
  FREE_COLOR,
  UNKNOWN_COLOR,
  buildGpuAllocationLegendModel,
  buildGpuOwnerGroups,
} from '../app/gpuAllocation';
import {
  type ChartPoint,
  type HostRealtimeHistory,
  type PerGpuRealtimeHistory,
  REALTIME_WINDOW_SECONDS,
  computeGpuMemoryUsagePercent,
  computeGpuTotals,
  formatDiskPairGb,
  formatMemoryGb,
  formatMemoryPairGb,
  getThresholdFillPercent,
  getUsagePalette,
  selectPrimaryDisk,
} from '../app/metrics';
import { styles } from '../app/styles';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const CHART_AXIS_LEFT = 2;
const CHART_AXIS_TOP = 2;
const CHART_AXIS_RIGHT = 100;
const CHART_AXIS_BOTTOM = 96;
const CHART_PLOT_LEFT = 6;
const CHART_PLOT_RIGHT = 98;
const CHART_PLOT_TOP = 4;
const CHART_PLOT_BOTTOM = 92;

function formatChartTime(time: number | null): string {
  if (!time) {
    return '--:--';
  }
  return new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function buildChartY(value: number): number {
  const percent = clamp(value, 0, 100);
  return CHART_PLOT_BOTTOM - ((percent / 100) * (CHART_PLOT_BOTTOM - CHART_PLOT_TOP));
}

function buildChartX(ratio: number): number {
  return CHART_PLOT_LEFT + (ratio * (CHART_PLOT_RIGHT - CHART_PLOT_LEFT));
}

function MetricBarRow(props: {
  label: string;
  value: string;
  percent: number;
}) {
  const percent = clamp(props.percent, 0, 100);
  const palette = getUsagePalette(props.percent);
  return (
    <View style={styles.metricBarRow}>
      <View style={styles.metricBarHeader}>
        <Text style={styles.metricBarLabel}>{props.label}</Text>
        <Text style={[styles.metricBarValue, { color: palette.textColor }]}>{props.value}</Text>
      </View>
      <View style={styles.metricBarTrack}>
        <View style={[styles.metricBarFill, { width: `${percent}%`, backgroundColor: palette.accentColor }]} />
      </View>
    </View>
  );
}

function ThresholdUsageBar(props: { usagePercent: number | undefined }) {
  const fillPercent = getThresholdFillPercent(props.usagePercent ?? 0);
  const palette = getUsagePalette(props.usagePercent);

  return (
    <View style={styles.thresholdTrack}>
      <View style={[styles.thresholdFillMask, { width: `${fillPercent}%`, backgroundColor: palette.accentColor }]} />
    </View>
  );
}

function buildPolyline(points: ChartPoint[]): string {
  if (points.length === 0) {
    return '';
  }

  if (points.length === 1) {
    const y = buildChartY(points[0].value);
    return `${CHART_PLOT_LEFT},${y} ${CHART_PLOT_RIGHT},${y}`;
  }

  const minTime = points[0].time;
  const maxTime = points[points.length - 1].time;
  const timeRange = Math.max(maxTime - minTime, 1);

  return points.map((point) => {
    const x = buildChartX((point.time - minTime) / timeRange);
    const y = buildChartY(point.value);
    return `${x},${y}`;
  }).join(' ');
}

function buildLastPoint(points: ChartPoint[]): { x: number; y: number } | null {
  if (points.length === 0) {
    return null;
  }

  if (points.length === 1) {
    return { x: CHART_PLOT_RIGHT, y: buildChartY(points[0].value) };
  }

  return { x: CHART_PLOT_RIGHT, y: buildChartY(points[points.length - 1].value) };
}

function MetricTrendChart(props: {
  series: Array<{ key: string; label: string; color: string; points: ChartPoint[] }>;
}) {
  const populated = props.series.filter((item) => item.points.length > 0);
  const timeline = populated.flatMap((item) => item.points);
  const startTime = timeline.length > 0 ? Math.min(...timeline.map((point) => point.time)) : null;
  const endTime = timeline.length > 0 ? Math.max(...timeline.map((point) => point.time)) : null;

  return (
    <View style={styles.chartShell}>
      <View style={styles.chartFrame}>
        <View style={styles.chartScaleColumn}>
          <Text style={styles.chartScaleLabel}>100%</Text>
          <Text style={styles.chartScaleLabel}>50%</Text>
          <Text style={styles.chartScaleLabel}>0%</Text>
        </View>
        <View style={styles.chartCanvasWrap}>
          <Svg width="100%" height={140} viewBox="0 0 100 100" preserveAspectRatio="none">
            <Line x1={String(CHART_AXIS_LEFT)} y1={String(CHART_AXIS_TOP)} x2={String(CHART_AXIS_LEFT)} y2={String(CHART_AXIS_BOTTOM)} stroke="#244157" strokeWidth="0.8" />
            <Line x1={String(CHART_AXIS_LEFT)} y1={String(buildChartY(100))} x2={String(CHART_AXIS_RIGHT)} y2={String(buildChartY(100))} stroke="#244157" strokeWidth="0.8" />
            <Line x1={String(CHART_AXIS_LEFT)} y1={String(buildChartY(50))} x2={String(CHART_AXIS_RIGHT)} y2={String(buildChartY(50))} stroke="#244157" strokeWidth="0.8" />
            <Line x1={String(CHART_AXIS_LEFT)} y1={String(CHART_AXIS_BOTTOM)} x2={String(CHART_AXIS_RIGHT)} y2={String(CHART_AXIS_BOTTOM)} stroke="#244157" strokeWidth="0.8" />
            {populated.map((item) => {
              const lastPoint = buildLastPoint(item.points);
              return (
                <G key={item.key}>
                  <Polyline
                    points={buildPolyline(item.points)}
                    fill="none"
                    stroke={item.color}
                    strokeWidth="1.35"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {lastPoint ? <Circle cx={lastPoint.x} cy={lastPoint.y} r="1.8" fill={item.color} /> : null}
                </G>
              );
            })}
          </Svg>
        </View>
      </View>
      <View style={styles.chartFooterRow}>
        <View style={styles.chartFooterSpacer} />
        <View style={styles.chartTimeRow}>
          <Text style={styles.chartTimeLabel}>{formatChartTime(startTime)}</Text>
          <Text style={styles.chartTimeLabel}>{formatChartTime(endTime)}</Text>
        </View>
      </View>
      <View style={styles.chartLegend}>
        {props.series.map((item) => (
          <View key={item.key} style={styles.chartLegendItem}>
            <View style={[styles.chartLegendSwatch, { backgroundColor: item.color }]} />
            <Text style={styles.chartLegendText}>{item.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function CpuMemoryTrendCard(props: {
  report: UnifiedReport;
  history: HostRealtimeHistory;
  loading: boolean;
}) {
  const fallbackTime = Date.now();
  const cpuUsage = props.report.resourceSnapshot.cpu.usagePercent;
  const memoryUsage = props.report.resourceSnapshot.memory.usagePercent;
  const series = [
    {
      key: 'cpu',
      label: 'CPU',
      color: '#57c5ff',
      points: props.history.cpuUsage.length
        ? props.history.cpuUsage
        : [{ time: fallbackTime, value: cpuUsage }],
    },
    {
      key: 'memory',
      label: 'RAM',
      color: '#ff8db1',
      points: props.history.memoryUsage.length
        ? props.history.memoryUsage
        : [{ time: fallbackTime, value: memoryUsage }],
    },
  ];

  return (
    <View style={styles.detailPanel}>
      <View style={styles.rowHeader}>
        <Text style={styles.detailPanelTitle}>CPU / 内存</Text>
        <Text style={styles.detailPanelValue}>{formatPercent(cpuUsage)} / {formatPercent(memoryUsage)}</Text>
      </View>
      <Text style={styles.detailPanelMeta}>统一按百分比刻度展示 CPU 与 RAM 最近 10 分钟走势。</Text>
      {props.loading ? <Text style={styles.chartLoadingText}>正在补齐最近 {Math.round(REALTIME_WINDOW_SECONDS / 60)} 分钟窗口…</Text> : null}
      <MetricTrendChart series={series} />
    </View>
  );
}

function GpuTrendCard(props: {
  gpu: GpuCardReport;
  history?: PerGpuRealtimeHistory;
  loading: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const fallbackTime = Date.now();
  const series = [
    {
      key: 'gpu',
      label: 'GPU',
      color: '#57c5ff',
      points: props.history?.utilization.length
        ? props.history.utilization
        : [{ time: fallbackTime, value: props.gpu.utilizationGpu }],
    },
    {
      key: 'vram',
      label: 'VRAM',
      color: '#ff8db1',
      points: props.history?.memoryUsage.length
        ? props.history.memoryUsage
        : [{ time: fallbackTime, value: computeGpuMemoryUsagePercent(props.gpu) }],
    },
    {
      key: 'bandwidth',
      label: '带宽',
      color: '#ffc46b',
      points: props.history?.memoryBandwidth.length
        ? props.history.memoryBandwidth
        : [{ time: fallbackTime, value: props.gpu.utilizationMemory }],
    },
  ];

  return (
    <View style={styles.detailPanel}>
      <View style={styles.rowHeader}>
        <Text style={styles.detailPanelTitle}>GPU {props.gpu.index} · {props.gpu.name}</Text>
        <Text style={styles.detailPanelValue}>{formatPercent(props.gpu.utilizationGpu)}</Text>
      </View>
      <Text style={styles.detailPanelMeta}>
        显存 {formatMemoryPairGb(props.gpu.memoryUsedMb, props.gpu.memoryTotalMb)} · 带宽 {formatPercent(props.gpu.utilizationMemory)}
      </Text>
      <Pressable
        style={[styles.detailPanelToggleButton, expanded ? styles.detailPanelToggleButtonExpanded : null]}
        onPress={() => setExpanded((current) => !current)}
      >
        <Text style={styles.detailPanelToggleText}>{expanded ? '收起走势' : '展开走势'}</Text>
      </Pressable>
      {expanded ? (
        <>
          {props.loading ? <Text style={styles.chartLoadingText}>正在补齐最近 {Math.round(REALTIME_WINDOW_SECONDS / 60)} 分钟窗口…</Text> : null}
          <MetricTrendChart series={series} />
        </>
      ) : null}
    </View>
  );
}

export function ServerCardVisuals(props: { report?: UnifiedReport }) {
  if (!props.report) {
    return <Text style={styles.serverVisualEmpty}>尚无实时资源数据。</Text>;
  }

  const gpuTotals = computeGpuTotals(props.report.resourceSnapshot.gpuCards);
  const rootDisk = selectPrimaryDisk(props.report.resourceSnapshot.disks);
  const diskPalette = getUsagePalette(rootDisk?.usagePercent);

  return (
    <View style={styles.serverVisualPanel}>
      <MetricBarRow
        label="GPU 利用率"
        value={props.report.resourceSnapshot.gpuCards.length > 0 ? formatPercent(gpuTotals.averageUtilization) : '无 GPU'}
        percent={gpuTotals.averageUtilization}
      />
      <MetricBarRow
        label="VRAM 占用"
        value={props.report.resourceSnapshot.gpuCards.length > 0 ? formatPercent(gpuTotals.totalVramPercent) : '无 GPU'}
        percent={gpuTotals.totalVramPercent}
      />
      <View style={styles.metricBarRow}>
        <View style={styles.metricBarHeader}>
          <Text style={styles.metricBarLabel}>系统盘</Text>
          <Text style={[styles.metricBarValue, rootDisk ? { color: diskPalette.textColor } : null]}>{rootDisk ? formatPercent(rootDisk.usagePercent) : '--'}</Text>
        </View>
        <ThresholdUsageBar usagePercent={rootDisk?.usagePercent} />
        <Text style={styles.serverVisualMeta}>
          {rootDisk ? `${rootDisk.mountPoint} · ${formatDiskPairGb(rootDisk.usedGB, rootDisk.totalGB)}` : '未识别到根目录磁盘'}
        </Text>
      </View>
    </View>
  );
}

export function GpuRealtimeSection(props: {
  gpuCards: GpuCardReport[];
  gpuRealtimeHistory: Record<number, PerGpuRealtimeHistory>;
  loading: boolean;
}) {
  if (props.gpuCards.length === 0) {
    return <Text style={styles.emptyText}>当前节点没有可展示的 GPU 指标。</Text>;
  }

  return (
    <View style={styles.panelStack}>
      {props.gpuCards.map((gpu) => (
        <GpuTrendCard
          key={gpu.index}
          gpu={gpu}
          history={props.gpuRealtimeHistory[gpu.index]}
          loading={props.loading}
        />
      ))}
    </View>
  );
}

export function DiskUsageSection(props: { report?: UnifiedReport }) {
  const disks = props.report?.resourceSnapshot.disks ?? [];

  if (disks.length === 0) {
    return <Text style={styles.emptyText}>当前没有磁盘占用数据。</Text>;
  }

  return (
    <View style={styles.panelStack}>
      {disks.map((disk) => {
        const palette = getUsagePalette(disk.usagePercent);

        return (
          <View key={`${disk.filesystem}-${disk.mountPoint}`} style={styles.detailPanel}>
            <View style={styles.rowHeader}>
              <Text style={styles.detailPanelTitle}>{disk.mountPoint}</Text>
              <Text style={[styles.detailPanelValue, { color: palette.textColor }]}>{formatPercent(disk.usagePercent)}</Text>
            </View>
            <Text style={styles.detailPanelMeta}>{disk.filesystem} · {formatDiskPairGb(disk.usedGB, disk.totalGB)}</Text>
            <ThresholdUsageBar usagePercent={disk.usagePercent} />
          </View>
        );
      })}
    </View>
  );
}

export function VramDistributionSection(props: {
  gpuCards: GpuCardReport[];
  tasks: TaskInfo[];
}) {
  if (props.gpuCards.length === 0) {
    return <Text style={styles.emptyText}>当前节点没有 VRAM 分布数据。</Text>;
  }

  const legendModel = buildGpuAllocationLegendModel(props.gpuCards, props.tasks, false);

  return (
    <View style={styles.panelStack}>
      {props.gpuCards.map((gpu) => {
        const allocation = buildGpuOwnerGroups(gpu, props.tasks, false);
        const denominator = Math.max(gpu.memoryTotalMb, allocation.totalDisplayedMb, 1);
        const segments = [
          ...allocation.groups.map((group) => ({
            key: group.key,
            color: group.baseColor,
            percent: ((group.managedReservedMb + group.unmanagedMb) / denominator) * 100,
          })),
          ...(allocation.unknownMb > 0 ? [{ key: 'unknown', color: UNKNOWN_COLOR, percent: (allocation.unknownMb / denominator) * 100 }] : []),
          ...(allocation.freeMb > 0 ? [{ key: 'free', color: FREE_COLOR, percent: (allocation.freeMb / denominator) * 100 }] : []),
        ].filter((item) => item.percent > 0);

        return (
          <View key={gpu.index} style={styles.detailPanel}>
            <View style={styles.rowHeader}>
              <Text style={styles.detailPanelTitle}>GPU {gpu.index} · {gpu.name}</Text>
              <Text style={styles.detailPanelValue}>{formatMemoryPairGb(gpu.memoryUsedMb, gpu.memoryTotalMb)}</Text>
            </View>
            <Text style={styles.detailPanelMeta}>
              调度可用 {formatMemoryGb(gpu.effectiveFreeMb)} · 托管预留 {formatMemoryGb(gpu.managedReservedMb)}
            </Text>
            <View style={styles.allocationTrack}>
              {segments.map((segment) => (
                <View key={`${gpu.index}-${segment.key}`} style={[styles.allocationSegment, { width: `${segment.percent}%`, backgroundColor: segment.color }]} />
              ))}
            </View>
          </View>
        );
      })}

      <View style={styles.allocationLegendWrap}>
        {legendModel.owners.map((owner) => (
          <View key={owner.key} style={styles.allocationLegendItem}>
            <View style={[styles.allocationLegendSwatch, { backgroundColor: owner.baseColor }]} />
            <Text style={styles.allocationLegendText}>{owner.label}</Text>
          </View>
        ))}
        {legendModel.unknownTotalMb > 0 ? (
          <View style={styles.allocationLegendItem}>
            <View style={[styles.allocationLegendSwatch, { backgroundColor: UNKNOWN_COLOR }]} />
            <Text style={styles.allocationLegendText}>未归属进程</Text>
          </View>
        ) : null}
        <View style={styles.allocationLegendItem}>
          <View style={[styles.allocationLegendSwatch, { backgroundColor: FREE_COLOR }]} />
          <Text style={styles.allocationLegendText}>可用显存</Text>
        </View>
      </View>
      {legendModel.note ? <Text style={styles.chartLoadingText}>{legendModel.note}</Text> : null}
    </View>
  );
}