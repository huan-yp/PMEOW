export type ChartPoint = { time: number; value: number };

interface AdaptiveRateSeriesInput {
  name: string;
  data: ChartPoint[];
  color?: string;
}

export interface AdaptiveRateChartAxis {
  position?: 'left' | 'right';
  formatter?: (value: number) => string;
  color?: string;
  splitLine?: boolean;
}

const BYTE_RATE_UNITS = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s'] as const;
export const AUTO_DUAL_RATE_AXIS_RATIO = 8;

export function formatBytesPerSecond(bytes: number): string {
  if (bytes === 0) {
    return '0 B/s';
  }

  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < BYTE_RATE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${BYTE_RATE_UNITS[unitIndex]}`;
}

export function formatRateAxisLabel(value: number, unit: string): string {
  const digits = value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${unit}`;
}

export function formatRateTooltipValue(value: number, unit: string): string {
  return formatRateAxisLabel(value, unit);
}

export function getRateChartScale(seriesList: ChartPoint[][]): { unit: string; divisor: number } {
  const maxValue = Math.max(
    0,
    ...seriesList.flatMap((series) => series.map((point) => point.value)),
  );

  let unitIndex = 0;
  let divisor = 1;
  let normalizedMax = maxValue;

  while (normalizedMax >= 1024 && unitIndex < BYTE_RATE_UNITS.length - 1) {
    normalizedMax /= 1024;
    divisor *= 1024;
    unitIndex += 1;
  }

  return {
    unit: BYTE_RATE_UNITS[unitIndex],
    divisor,
  };
}

export function scaleRateChartData(data: ChartPoint[], divisor: number): ChartPoint[] {
  if (divisor === 1) {
    return data;
  }

  return data.map((point) => ({
    ...point,
    value: point.value / divisor,
  }));
}

function getRateSeriesPeak(data: ChartPoint[]): number {
  return Math.max(0, ...data.map((point) => point.value));
}

export function buildAdaptiveRateChart(seriesList: AdaptiveRateSeriesInput[], threshold = AUTO_DUAL_RATE_AXIS_RATIO) {
  const peaks = seriesList.map((series) => getRateSeriesPeak(series.data));
  const nonZeroPeaks = peaks.filter((peak) => peak > 0);
  const shouldUseDualAxes = seriesList.length === 2
    && nonZeroPeaks.length === 2
    && Math.max(...nonZeroPeaks) / Math.min(...nonZeroPeaks) >= threshold;

  if (!shouldUseDualAxes) {
    const scale = getRateChartScale(seriesList.map((series) => series.data));

    return {
      usesDualAxes: false,
      unitLabel: scale.unit,
      yAxes: [
        {
          position: 'left' as const,
          formatter: (value: number) => formatRateAxisLabel(value, scale.unit),
        },
      ],
      series: seriesList.map((series) => ({
        ...series,
        data: scaleRateChartData(series.data, scale.divisor),
        unit: scale.unit,
        yAxisIndex: 0,
        valueFormatter: (value: number) => formatRateTooltipValue(value, scale.unit),
      })),
    };
  }

  const [leftSeries, rightSeries] = seriesList;
  const leftScale = getRateChartScale([leftSeries.data]);
  const rightScale = getRateChartScale([rightSeries.data]);

  return {
    usesDualAxes: true,
    unitLabel: `左 ${leftScale.unit} / 右 ${rightScale.unit}`,
    yAxes: [
      {
        position: 'left' as const,
        formatter: (value: number) => formatRateAxisLabel(value, leftScale.unit),
        color: leftSeries.color,
        splitLine: true,
      },
      {
        position: 'right' as const,
        formatter: (value: number) => formatRateAxisLabel(value, rightScale.unit),
        color: rightSeries.color,
        splitLine: false,
      },
    ],
    series: [
      {
        ...leftSeries,
        data: scaleRateChartData(leftSeries.data, leftScale.divisor),
        unit: leftScale.unit,
        yAxisIndex: 0,
        valueFormatter: (value: number) => formatRateTooltipValue(value, leftScale.unit),
      },
      {
        ...rightSeries,
        data: scaleRateChartData(rightSeries.data, rightScale.divisor),
        unit: rightScale.unit,
        yAxisIndex: 1,
        valueFormatter: (value: number) => formatRateTooltipValue(value, rightScale.unit),
      },
    ],
  };
}