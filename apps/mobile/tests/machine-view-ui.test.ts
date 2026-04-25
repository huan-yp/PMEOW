import { describe, expect, it } from 'vitest';
import {
  MACHINE_VIEW_PAGES,
  getInitialServerCardExpanded,
  getMachinePagerPageWidth,
  getMachineViewPageIndex,
  getMachineViewPageView,
} from '../src/app/machineView';

describe('machine view UI defaults', () => {
  it('starts on the preferred machine view page', () => {
    expect(getMachineViewPageIndex('summary')).toBe(0);
    expect(getMachineViewPageIndex('gpuIdle')).toBe(1);
    expect(getMachineViewPageView(0)).toBe('summary');
    expect(getMachineViewPageView(1)).toBe('gpuIdle');
    expect(MACHINE_VIEW_PAGES.map((page) => page.view)).toEqual(['summary', 'gpuIdle']);
  });

  it('keeps machine summary cards collapsed by default', () => {
    expect(getInitialServerCardExpanded()).toBe(false);
  });

  it('uses the measured pager container width before falling back to window width', () => {
    expect(getMachinePagerPageWidth(320, 390)).toBe(320);
    expect(getMachinePagerPageWidth(0, 390)).toBe(390);
    expect(getMachinePagerPageWidth(undefined, 390)).toBe(390);
  });
});
