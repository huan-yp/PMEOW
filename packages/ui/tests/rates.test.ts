import { describe, expect, it } from 'vitest';
import { AUTO_DUAL_RATE_AXIS_RATIO, buildAdaptiveRateChart, formatBytesPerSecond } from '../src/utils/rates';

describe('rates utilities', () => {
  it('uses a shared axis when series are in a similar range', () => {
    const chart = buildAdaptiveRateChart([
      {
        name: '接收',
        color: '#10b981',
        data: [
          { time: 1, value: 800 },
          { time: 2, value: 1200 },
        ],
      },
      {
        name: '发送',
        color: '#3b82f6',
        data: [
          { time: 1, value: 600 },
          { time: 2, value: 900 },
        ],
      },
    ]);

    expect(chart.usesDualAxes).toBe(false);
    expect(chart.unitLabel).toBe('KB/s');
    expect(chart.series.every((series) => series.yAxisIndex === 0)).toBe(true);
    expect(chart.series[0].unit).toBe('KB/s');
    expect(chart.yAxes).toHaveLength(1);
  });

  it('switches to left and right axes when the ratio is too large', () => {
    const chart = buildAdaptiveRateChart([
      {
        name: '读取',
        color: '#06b6d4',
        data: [
          { time: 1, value: 4096 },
          { time: 2, value: 8192 },
        ],
      },
      {
        name: '写入',
        color: '#f59e0b',
        data: [
          { time: 1, value: 16 },
          { time: 2, value: 32 },
        ],
      },
    ], AUTO_DUAL_RATE_AXIS_RATIO);

    expect(chart.usesDualAxes).toBe(true);
    expect(chart.unitLabel).toBe('左 KB/s / 右 B/s');
    expect(chart.series[0].yAxisIndex).toBe(0);
    expect(chart.series[1].yAxisIndex).toBe(1);
    expect(chart.series[0].unit).toBe('KB/s');
    expect(chart.series[1].unit).toBe('B/s');
    expect(chart.yAxes).toHaveLength(2);
  });

  it('formats byte rates with readable units', () => {
    expect(formatBytesPerSecond(0)).toBe('0 B/s');
    expect(formatBytesPerSecond(1536)).toBe('1.5 KB/s');
    expect(formatBytesPerSecond(5 * 1024 * 1024)).toBe('5.0 MB/s');
  });
});