import { describe, expect, it } from 'vitest';
import {
  METRIC_CHART_COMPACT_BREAKPOINT,
  resolveMetricChartResponsivePolicy,
} from '../src/utils/metricChart.js';

describe('metric chart responsive policy', () => {
  it('treats charts without explicit axes as a wide single left axis', () => {
    const policy = resolveMetricChartResponsivePolicy({
      containerWidth: 720,
    });

    expect(policy).toEqual({
      compact: false,
      gridLeft: 48,
      gridRight: 18,
      showLeftAxisLabels: true,
      showRightAxisLabels: false,
    });
  });

  it('shrinks left padding and hides y-axis labels on narrow single-axis charts', () => {
    const policy = resolveMetricChartResponsivePolicy({
      containerWidth: 360,
      axes: [{ position: 'left' }],
    });

    expect(policy).toEqual({
      compact: true,
      gridLeft: 20,
      gridRight: 10,
      showLeftAxisLabels: false,
      showRightAxisLabels: false,
    });
  });

  it('preserves both axis labels on wide dual-axis charts', () => {
    const policy = resolveMetricChartResponsivePolicy({
      containerWidth: 720,
      axes: [{ position: 'left' }, { position: 'right' }],
    });

    expect(policy).toEqual({
      compact: false,
      gridLeft: 52,
      gridRight: 52,
      showLeftAxisLabels: true,
      showRightAxisLabels: true,
    });
  });

  it('shrinks both sides and hides y-axis labels on narrow dual-axis charts', () => {
    const policy = resolveMetricChartResponsivePolicy({
      containerWidth: 360,
      axes: [{ position: 'left' }, { position: 'right' }],
    });

    expect(policy).toEqual({
      compact: true,
      gridLeft: 20,
      gridRight: 16,
      showLeftAxisLabels: false,
      showRightAxisLabels: false,
    });
  });

  it('uses the axis position instead of the array index when calculating wide layouts', () => {
    const policy = resolveMetricChartResponsivePolicy({
      containerWidth: METRIC_CHART_COMPACT_BREAKPOINT,
      axes: [{ position: 'right' }],
    });

    expect(policy).toEqual({
      compact: false,
      gridLeft: 18,
      gridRight: 52,
      showLeftAxisLabels: false,
      showRightAxisLabels: true,
    });
  });
});