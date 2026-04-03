import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

export interface MetricChartSeries {
  name: string;
  data: { time: number; value: number }[];
  color?: string;
  unit?: string;
  yAxisIndex?: number;
  valueFormatter?: (value: number) => string;
}

export interface MetricChartAxis {
  position?: 'left' | 'right';
  formatter?: (value: number) => string;
  color?: string;
  splitLine?: boolean;
}

interface Props {
  series: MetricChartSeries[];
  height?: number;
  yAxisFormatter?: (v: number) => string;
  yAxes?: MetricChartAxis[];
}

export function MetricChart({ series, height = 200, yAxisFormatter, yAxes }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;
    chartInstance.current = echarts.init(chartRef.current, undefined, {
      renderer: 'canvas',
    });

    const handleResize = () => chartInstance.current?.resize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chartInstance.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!chartInstance.current || series.length === 0) return;

    const defaultColors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
    const axisConfigs = yAxes && yAxes.length > 0
      ? yAxes
      : [{ formatter: yAxisFormatter } satisfies MetricChartAxis];
    const hasRightAxis = axisConfigs.length > 1;
    const gridLeft = hasRightAxis ? 52 : 48;
    const gridRight = hasRightAxis ? 52 : 18;

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
            const value = Number(p.value[1] ?? 0);
            const formattedValue = s?.valueFormatter
              ? s.valueFormatter(value)
              : s?.unit
                ? `${value.toFixed(1)}${s.unit}`
                : value.toFixed(1);
            html += `<div>${p.marker} ${p.seriesName}: <b>${formattedValue}</b></div>`;
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
      grid: {
        top: 10,
        right: gridRight,
        bottom: series.length > 1 ? 30 : 10,
        left: gridLeft,
        containLabel: true,
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: '#1e293b' } },
        axisLabel: {
          color: '#64748b',
          fontSize: 10,
          formatter: (v: number) => new Date(v).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        },
        splitLine: { show: false },
      },
      yAxis: axisConfigs.map((axisConfig, index) => ({
        type: 'value',
        min: 0,
        position: axisConfig.position ?? (index === 0 ? 'left' : 'right'),
        axisLine: { show: false },
        axisLabel: {
          color: axisConfig.color || '#64748b',
          fontSize: 10,
          margin: 8,
          formatter: axisConfig.formatter || ((v: number) => `${v}`),
        },
        splitLine: {
          show: axisConfig.splitLine ?? index === 0,
          lineStyle: { color: '#1e293b', type: 'dashed' },
        },
      })),
      series: series.map((s, i) => ({
        name: s.name,
        type: 'line',
        smooth: true,
        symbol: 'none',
        yAxisIndex: s.yAxisIndex ?? 0,
        lineStyle: { width: 2, color: s.color || defaultColors[i % defaultColors.length] },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: (s.color || defaultColors[i % defaultColors.length]) + '30' },
            { offset: 1, color: (s.color || defaultColors[i % defaultColors.length]) + '05' },
          ]),
        },
        data: s.data.map(d => [d.time, d.value]),
      })),
      animation: false,
    }, true);
  }, [series, yAxes, yAxisFormatter]);

  return (
    <div ref={chartRef} style={{ width: '100%', height }} />
  );
}
