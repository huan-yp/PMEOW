import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';

export interface TimeSeriesChartSeries {
  name: string;
  data: { time: number; value: number }[];
  color?: string;
  unit?: string;
  yAxisIndex?: number;
}

interface Props {
  series: TimeSeriesChartSeries[];
  height?: number;
  yAxisFormatter?: (v: number) => string;
  yAxisMin?: number;
  yAxisMax?: number;
}

export function TimeSeriesChart({ series, height = 200, yAxisFormatter, yAxisMin, yAxisMax }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;
    chartInstance.current = echarts.init(chartRef.current, undefined, { renderer: 'canvas' });
    const handleResize = () => chartInstance.current?.resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(handleResize) : null;
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
            const formatted = s?.unit ? `${val.toFixed(1)}${s.unit}` : val.toFixed(1);
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
      grid: { top: 10, right: 20, bottom: series.length > 1 ? 30 : 10, left: 20, containLabel: true },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: '#1e293b' } },
        axisLabel: { color: '#64748b', fontSize: 10, hideOverlap: true, formatter: (v: number) => new Date(v).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        min: yAxisMin,
        max: yAxisMax,
        axisLabel: { color: '#64748b', fontSize: 10, formatter: yAxisFormatter },
        splitLine: { lineStyle: { color: '#1e293b', type: 'dashed' } },
      },
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
  }, [series, yAxisFormatter, yAxisMin, yAxisMax]);

  return <div ref={chartRef} style={{ width: '100%', height }} />;
}
