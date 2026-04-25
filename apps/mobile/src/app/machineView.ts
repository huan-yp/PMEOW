import type { MobileHomeView } from '../lib/preferences';

export const MACHINE_VIEW_PAGES: Array<{ view: MobileHomeView; label: string }> = [
  { view: 'summary', label: '机器摘要' },
  { view: 'gpuIdle', label: 'GPU 空闲情况' },
];

export function getMachineViewPageIndex(view: MobileHomeView): number {
  return Math.max(0, MACHINE_VIEW_PAGES.findIndex((page) => page.view === view));
}

export function getMachineViewPageView(index: number): MobileHomeView {
  return MACHINE_VIEW_PAGES[index]?.view ?? MACHINE_VIEW_PAGES[0].view;
}

export function getInitialServerCardExpanded(): boolean {
  return false;
}

export function getMachinePagerPageWidth(measuredWidth: number | undefined, fallbackWidth: number): number {
  return Math.max(1, measuredWidth && measuredWidth > 0 ? measuredWidth : fallbackWidth);
}
