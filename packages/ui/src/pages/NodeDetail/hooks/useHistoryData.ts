import { useState, useEffect, useCallback } from 'react';
import { useTransport } from '../../../transport/TransportProvider.js';
import type { SnapshotWithGpu } from '../../../transport/types.js';
import type { Tab, HistoryRangeQuery, HistoryPreset } from '../utils/types.js';
import { buildPresetRange, formatDateTimeLocal, parseDateTimeLocal } from '../utils/history.js';

export function useHistoryData(id: string | undefined, tab: Tab) {
  const transport = useTransport();

  const [historyRange, setHistoryRange] = useState<HistoryRangeQuery>(() => buildPresetRange('24h'));
  const [customHistoryFrom, setCustomHistoryFrom] = useState(() => formatDateTimeLocal(buildPresetRange('24h').from));
  const [customHistoryTo, setCustomHistoryTo] = useState(() => formatDateTimeLocal(buildPresetRange('24h').to));
  const [historySnapshots, setHistorySnapshots] = useState<SnapshotWithGpu[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Reset on node change
  useEffect(() => {
    setHistoryRange(buildPresetRange('24h'));
    setCustomHistoryFrom(formatDateTimeLocal(buildPresetRange('24h').from));
    setCustomHistoryTo(formatDateTimeLocal(buildPresetRange('24h').to));
    setHistorySnapshots([]);
  }, [id]);

  const loadHistory = useCallback(async (query: Pick<HistoryRangeQuery, 'from' | 'to'>) => {
    if (!id) return;
    setHistoryLoading(true);
    try {
      const res = await transport.getMetricsHistory(id, query);
      setHistorySnapshots(res.snapshots);
    } catch { /* ignore */ }
    setHistoryLoading(false);
  }, [id, transport]);

  useEffect(() => {
    if (tab === 'history') {
      void loadHistory({ from: historyRange.from, to: historyRange.to });
    }
  }, [tab, historyRange, loadHistory]);

  const applyPreset = useCallback((preset: Exclude<HistoryPreset, 'custom'>) => {
    const next = buildPresetRange(preset);
    setHistoryRange(next);
    setCustomHistoryFrom(formatDateTimeLocal(next.from));
    setCustomHistoryTo(formatDateTimeLocal(next.to));
  }, []);

  const applyCustomRange = useCallback(() => {
    const from = parseDateTimeLocal(customHistoryFrom);
    const to = parseDateTimeLocal(customHistoryTo);
    if (from == null || to == null || from >= to) return;
    setHistoryRange({ preset: 'custom', from, to });
  }, [customHistoryFrom, customHistoryTo]);

  return {
    historyRange,
    historySnapshots,
    historyLoading,
    customHistoryFrom,
    customHistoryTo,
    setCustomHistoryFrom,
    setCustomHistoryTo,
    applyPreset,
    applyCustomRange,
  };
}
