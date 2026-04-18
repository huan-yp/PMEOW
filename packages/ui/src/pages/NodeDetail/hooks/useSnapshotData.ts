import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTransport } from '../../../transport/TransportProvider.js';
import type { SnapshotWithGpu } from '../../../transport/types.js';
import type { Tab } from '../utils/types.js';
import { SNAPSHOT_TIMELINE_FROM } from '../utils/types.js';

export function useSnapshotData(id: string | undefined, tab: Tab) {
  const transport = useTransport();

  const [snapshotTimeline, setSnapshotTimeline] = useState<SnapshotWithGpu[]>([]);
  const [selectedSnapshotTs, setSelectedSnapshotTs] = useState<number | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  // Reset on node change
  useEffect(() => {
    setSnapshotTimeline([]);
    setSelectedSnapshotTs(null);
  }, [id]);

  const loadSnapshotTimeline = useCallback(async () => {
    if (!id) return;
    setSnapshotLoading(true);
    try {
      const res = await transport.getMetricsHistory(id, {
        from: SNAPSHOT_TIMELINE_FROM,
        to: Math.floor(Date.now() / 1000),
      });
      setSnapshotTimeline(res.snapshots);
      setSelectedSnapshotTs((current) => current ?? res.snapshots[res.snapshots.length - 1]?.timestamp ?? null);
    } catch {
      setSnapshotTimeline([]);
    }
    setSnapshotLoading(false);
  }, [id, transport]);

  useEffect(() => {
    if (tab === 'snapshot') {
      void loadSnapshotTimeline();
    }
  }, [tab, loadSnapshotTimeline]);

  const selectedSnapshot = useMemo(() => {
    if (snapshotTimeline.length === 0) return undefined;
    if (selectedSnapshotTs == null) return snapshotTimeline[snapshotTimeline.length - 1];
    return snapshotTimeline.find((s) => s.timestamp === selectedSnapshotTs);
  }, [snapshotTimeline, selectedSnapshotTs]);

  return {
    snapshotTimeline,
    selectedSnapshotTs,
    selectedSnapshot,
    snapshotLoading,
    setSelectedSnapshotTs,
  };
}
