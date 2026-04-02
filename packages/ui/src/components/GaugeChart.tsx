import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

interface Props {
  value: number;
  label: string;
  size?: number;
}

function getColor(value: number): string {
  if (value >= 90) return '#ef4444';
  if (value >= 70) return '#f59e0b';
  return '#10b981';
}

export function GaugeChart({ value, label, size = 100 }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;
    chartInstance.current = echarts.init(chartRef.current, undefined, {
      renderer: 'canvas',
    });

    return () => {
      chartInstance.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!chartInstance.current) return;

    chartInstance.current.setOption({
      series: [{
        type: 'gauge',
        startAngle: 210,
        endAngle: -30,
        min: 0,
        max: 100,
        radius: '90%',
        progress: {
          show: true,
          width: 8,
          roundCap: true,
          itemStyle: {
            color: getColor(value),
          },
        },
        pointer: { show: false },
        axisLine: {
          lineStyle: {
            width: 8,
            color: [[1, '#1e293b']],
          },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        title: {
          show: true,
          offsetCenter: [0, '60%'],
          fontSize: 10,
          color: '#64748b',
        },
        detail: {
          valueAnimation: true,
          offsetCenter: [0, '10%'],
          fontSize: size > 80 ? 16 : 14,
          fontWeight: 'bold',
          formatter: '{value}%',
          color: getColor(value),
        },
        data: [{ value: Math.round(value * 10) / 10, name: label }],
      }],
    });
  }, [value, label, size]);

  return (
    <div
      ref={chartRef}
      style={{ width: size, height: size, margin: '0 auto' }}
    />
  );
}
