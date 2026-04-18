import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';

export interface TimeSeriesChartSeries {
  name: string;
  data: { time: number; value: number }[];
  color?: string;
  unit?: string;
  yAxisIndex?: number;
  valueFormatter?: (value: number) => string;
}

export interface TimeSeriesChartAxis {
  position?: 'left' | 'right';
  formatter?: (v: number) => string;
  min?: number;
  max?: number;
  color?: string;
  splitLine?: boolean;
}

interface Props {
  series: TimeSeriesChartSeries[];
  height?: number;
  yAxes?: TimeSeriesChartAxis[];
  yAxisFormatter?: (v: number) => string;
  yAxisMin?: number;
  yAxisMax?: number;
}

export function TimeSeriesChart({
  series,
  height = 200,
  yAxes,
  yAxisFormatter,
  yAxisMin,
  yAxisMax,
}: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (!chartRef.current) return;
    chartInstance.current = echarts.init(chartRef.current, undefined, { renderer: 'canvas' });
    const handleResize = () => {
      chartInstance.current?.resize();
      setContainerWidth(chartRef.current?.clientWidth ?? 0);
    };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(handleResize) : null;
    setContainerWidth(chartRef.current.clientWidth);
    if (ro && chartRef.current) ro.observe(chartRef.current);
    window.addEventListener('resize', handleResize);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', handleResize);
      chartInstance.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!chartInstance.current || series.length === 0) return;
    const defaultColors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
    const resolvedAxes = yAxes && yAxes.length > 0
      ? yAxes
      : [{ formatter: yAxisFormatter, min: yAxisMin, max: yAxisMax, position: 'left' as const }];
    const hasRightAxis = resolvedAxes.some((axis) => axis.position === 'right');
    const compact = containerWidth > 0 && containerWidth < 480;
    const gridLeft = compact ? 20 : resolvedAxes.length > 1 ? 52 : 20;
    const gridRight = compact ? 16 : hasRightAxis ? 52 : 20;

    chartInstance.current.setOption({
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(17, 24, 39, 0.95)',
        borderColor: '#1e293b',
        textStyle: { color: '#e2e8f0', fontSize: 12 },
        formatter: (params: any) => {
          if (!Array.isArray(params)) return '';
          const time = new Date(params[0]?.axisValue).toLocaleTimeString('zh-CN');
          let html = `<div style="margin-bottom:4px;color:#94a3b8">${time}</div>`;
          for (const p of params) {
            const s = series[p.seriesIndex];
            const val = Number(p.value[1] ?? 0);
            const formatted = s?.valueFormatter
              ? s.valueFormatter(val)
              : s?.unit
                ? `${val.toFixed(1)}${s.unit}`
                : val.toFixed(1);
            html += `<div>${p.marker} ${p.seriesName}: <b>${formatted}</b></div>`;
          }
          return html;
        },
      },
      legend: {
        show: series.length > 1,
        bottom: 0,
        textStyle: { color: '#64748b', fontSize: 11 },
        itemWidth: 12,
        itemHeight: 3,
      },
      grid: { top: 10, right: gridRight, bottom: series.length > 1 ? 30 : 10, left: gridLeft, containLabel: true },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: '#1e293b' } },
        axisLabel: { color: '#64748b', fontSize: 10, hideOverlap: true, formatter: (v: number) => new Date(v).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) },
        splitLine: { show: false },
      },
      yAxis: resolvedAxes.map((axis, index) => ({
        type: 'value',
        position: axis.position ?? (index === 0 ? 'left' : 'right'),
        min: axis.min,
        max: axis.max,
        axisLine: { show: true, lineStyle: { color: axis.color || '#1e293b' } },
        axisTick: { show: false },
        axisLabel: {
          show: !compact,
          color: axis.color || '#64748b',
          fontSize: 10,
          formatter: axis.formatter,
        },
        splitLine: {
          show: axis.splitLine ?? index === 0,
          lineStyle: { color: '#1e293b', type: 'dashed' },
        },
      })),
      series: series.map((s, i) => ({
        name: s.name,
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 1.5 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: (s.color || defaultColors[i % defaultColors.length]) + '40' },
          { offset: 1, color: (s.color || defaultColors[i % defaultColors.length]) + '05' },
        ]) },
        itemStyle: { color: s.color || defaultColors[i % defaultColors.length] },
        yAxisIndex: s.yAxisIndex ?? 0,
        data: s.data.map(d => [d.time, d.value]),
      })),
    }, true);
  }, [containerWidth, series, yAxes, yAxisFormatter, yAxisMin, yAxisMax]);

  return <div ref={chartRef} style={{ width: '100%', height }} />;
}
