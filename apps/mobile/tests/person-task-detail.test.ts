import { describe, expect, it } from 'vitest';
import * as constants from '../src/app/constants';
import * as formatters from '../src/app/formatters';

describe('person task detail navigation semantics', () => {
  it('treats task detail as a substate of the tasks tab', () => {
    const isPersonTaskDetailVisible = (
      constants as typeof constants & {
        isPersonTaskDetailVisible?: (tab: constants.PersonTab, selectedTaskId: string | null) => boolean;
      }
    ).isPersonTaskDetailVisible;

    expect(typeof isPersonTaskDetailVisible).toBe('function');
    if (typeof isPersonTaskDetailVisible !== 'function') {
      return;
    }

    expect(isPersonTaskDetailVisible('tasks', 'task-1')).toBe(true);
    expect(isPersonTaskDetailVisible('home', 'task-1')).toBe(false);
    expect(isPersonTaskDetailVisible('tasks', null)).toBe(false);
  });

  it('clears the selected task when the user leaves the tasks tab', () => {
    const normalizeSelectedTaskIdForTab = (
      constants as typeof constants & {
        normalizeSelectedTaskIdForTab?: (tab: constants.PersonTab, selectedTaskId: string | null) => string | null;
      }
    ).normalizeSelectedTaskIdForTab;

    expect(typeof normalizeSelectedTaskIdForTab).toBe('function');
    if (typeof normalizeSelectedTaskIdForTab !== 'function') {
      return;
    }

    expect(normalizeSelectedTaskIdForTab('tasks', 'task-1')).toBe('task-1');
    expect(normalizeSelectedTaskIdForTab('home', 'task-1')).toBeNull();
    expect(normalizeSelectedTaskIdForTab('settings', 'task-1')).toBeNull();
  });
});

describe('task detail field formatting', () => {
  it('formats empty detail values as an em dash placeholder', () => {
    const formatTaskDetailValue = (
      formatters as typeof formatters & {
        formatTaskDetailValue?: (value: string | number | null | undefined) => string;
      }
    ).formatTaskDetailValue;

    expect(typeof formatTaskDetailValue).toBe('function');
    if (typeof formatTaskDetailValue !== 'function') {
      return;
    }

    expect(formatTaskDetailValue(null)).toBe('—');
    expect(formatTaskDetailValue(undefined)).toBe('—');
    expect(formatTaskDetailValue('')).toBe('—');
    expect(formatTaskDetailValue(' /workspace ')).toBe('/workspace');
    expect(formatTaskDetailValue(0)).toBe('0');
  });
});

describe('tab swipe index helpers', () => {
  it('tabToIndex returns the correct index for a known tab id', () => {
    expect(constants.tabToIndex(constants.PERSON_TABS, 'home')).toBe(0);
    expect(constants.tabToIndex(constants.PERSON_TABS, 'tasks')).toBe(1);
    expect(constants.tabToIndex(constants.PERSON_TABS, 'settings')).toBe(2);
  });

  it('tabToIndex returns 0 for an unknown tab id', () => {
    expect(constants.tabToIndex(constants.PERSON_TABS, 'nonexistent' as constants.PersonTab)).toBe(0);
  });

  it('indexToTab returns the correct tab id for a valid index', () => {
    expect(constants.indexToTab(constants.ADMIN_TABS, 0)).toBe('dashboard');
    expect(constants.indexToTab(constants.ADMIN_TABS, 1)).toBe('alerts');
    expect(constants.indexToTab(constants.ADMIN_TABS, 2)).toBe('settings');
  });

  it('indexToTab falls back to tabs[0].id for an out-of-range index', () => {
    expect(constants.indexToTab(constants.PERSON_TABS, 99)).toBe('home');
    expect(constants.indexToTab(constants.PERSON_TABS, -1)).toBe('home');
  });
});

describe('mobile Chinese labels', () => {
  it('keeps bottom tab labels readable', () => {
    expect(constants.PERSON_TABS.map((tab) => tab.label)).toEqual(['首页', '我的任务', '设置']);
  });

  it('keeps task status labels readable', () => {
    expect(formatters.formatTaskStatus('queued')).toBe('排队中');
    expect(formatters.formatTaskStatus('running')).toBe('运行中');
    expect(formatters.formatTaskStatus('succeeded')).toBe('已成功');
    expect(formatters.formatTaskStatus('failed')).toBe('失败');
    expect(formatters.formatTaskStatus('cancelled')).toBe('已取消');
    expect(formatters.formatTaskStatus('abnormal')).toBe('异常');
  });
});
