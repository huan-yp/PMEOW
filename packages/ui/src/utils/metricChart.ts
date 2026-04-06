export const METRIC_CHART_COMPACT_BREAKPOINT = 480;

export interface MetricChartResponsiveAxis {
  position?: 'left' | 'right';
}

export interface MetricChartResponsivePolicy {
  compact: boolean;
  gridLeft: number;
  gridRight: number;
  showLeftAxisLabels: boolean;
  showRightAxisLabels: boolean;
}

interface ResolveMetricChartResponsivePolicyInput {
  containerWidth: number;
  axes?: MetricChartResponsiveAxis[];
  compactBreakpoint?: number;
}

function resolveAxisPosition(axis: MetricChartResponsiveAxis, index: number): 'left' | 'right' {
  return axis.position ?? (index === 0 ? 'left' : 'right');
}

export function resolveMetricChartResponsivePolicy({
  containerWidth,
  axes = [{}],
  compactBreakpoint = METRIC_CHART_COMPACT_BREAKPOINT,
}: ResolveMetricChartResponsivePolicyInput): MetricChartResponsivePolicy {
  const resolvedAxes = axes.length > 0 ? axes : [{}];
  const axisPositions = resolvedAxes.map((axis, index) => resolveAxisPosition(axis, index));
  const hasLeftAxis = axisPositions.includes('left');
  const hasRightAxis = axisPositions.includes('right');
  const compact = containerWidth > 0 && containerWidth < compactBreakpoint;

  if (compact) {
    return {
      compact: true,
      gridLeft: hasLeftAxis ? 20 : 10,
      gridRight: hasRightAxis ? 16 : 10,
      showLeftAxisLabels: false,
      showRightAxisLabels: false,
    };
  }

  if (hasLeftAxis && hasRightAxis) {
    return {
      compact: false,
      gridLeft: 52,
      gridRight: 52,
      showLeftAxisLabels: true,
      showRightAxisLabels: true,
    };
  }

  return {
    compact: false,
    gridLeft: hasLeftAxis ? 48 : 18,
    gridRight: hasRightAxis ? 52 : 18,
    showLeftAxisLabels: hasLeftAxis,
    showRightAxisLabels: hasRightAxis,
  };
}