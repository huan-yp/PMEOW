import type { MetricsSnapshot } from '@monitor/core';

export type InternetReachabilityState = 'reachable' | 'unreachable' | 'unprobed';

export function getConnectionStatusVisual(status: string) {
  switch (status) {
    case 'connected':
      return {
        label: '在线',
        badgeClassName: 'node-badge-status-online',
        dotClassName: 'bg-sky-300',
        surfaceClassName: 'node-surface-shell-online',
      };
    case 'connecting':
      return {
        label: '连接中',
        badgeClassName: 'node-badge-status-connecting',
        dotClassName: 'bg-amber-300 animate-pulse-dot',
        surfaceClassName: 'node-surface-shell-connecting',
      };
    case 'error':
      return {
        label: '异常',
        badgeClassName: 'node-badge-status-error',
        dotClassName: 'bg-rose-300',
        surfaceClassName: 'node-surface-shell-error',
      };
    case 'disconnected':
    default:
      return {
        label: '离线',
        badgeClassName: 'node-badge-status-offline',
        dotClassName: 'bg-rose-300',
        surfaceClassName: 'node-surface-shell-offline',
      };
  }
}

export function getInternetReachabilityState(metrics?: MetricsSnapshot): InternetReachabilityState {
  if (metrics?.network.internetReachable === true) {
    return 'reachable';
  }
  if (metrics?.network.internetReachable === false) {
    return 'unreachable';
  }
  return 'unprobed';
}

export function getInternetStatusVisual(state: InternetReachabilityState) {
  switch (state) {
    case 'reachable':
      return {
        label: '可达',
        badgeClassName: 'node-badge-status-online',
        dotClassName: 'bg-emerald-300',
      };
    case 'unreachable':
      return {
        label: '不可达',
        badgeClassName: 'node-badge-status-offline',
        dotClassName: 'bg-rose-300',
      };
    case 'unprobed':
    default:
      return {
        label: '未探测',
        badgeClassName: 'node-badge-status-neutral',
        dotClassName: 'bg-slate-400',
      };
  }
}