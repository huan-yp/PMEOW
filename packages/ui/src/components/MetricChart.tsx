import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

interface Series {
  name: string;
  data: { time: number; value: number }[];
  color?: string;
  unit?: string;
}

interface Props {
  series: Series[];
  height?: number;
  yAxisFormatter?: (v: number) => string;
}

export function MetricChart({ series, height = 200, yAxisFormatter }: Props) {
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
            const unit = s?.unit || '';
            html += `<div>${p.marker} ${p.seriesName}: <b>${p.value[1].toFixed(1)}${unit}</b></div>`;
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
        right: 16,
        bottom: series.length > 1 ? 30 : 10,
        left: 50,
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
      yAxis: {
        type: 'value',
        min: 0,
        axisLine: { show: false },
        axisLabel: {
          color: '#64748b',
          fontSize: 10,
          formatter: yAxisFormatter || ((v: number) => `${v}`),
        },
        splitLine: {
          lineStyle: { color: '#1e293b', type: 'dashed' },
        },
      },
      series: series.map((s, i) => ({
        name: s.name,
        type: 'line',
        smooth: true,
        symbol: 'none',
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
  }, [series, yAxisFormatter]);

  return (
    <div ref={chartRef} style={{ width: '100%', height }} />
  );
}
