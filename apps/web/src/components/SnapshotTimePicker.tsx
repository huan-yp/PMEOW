import { useMemo } from 'react';

interface Props {
  snapshots: { timestamp: number }[];
  selectedTimestamp: number | null;
  onSelect: (timestamp: number) => void;
}

export function SnapshotTimePicker({ snapshots, selectedTimestamp, onSelect }: Props) {
  const sorted = useMemo(
    () => [...snapshots].sort((a, b) => a.timestamp - b.timestamp),
    [snapshots],
  );

  if (sorted.length === 0) {
    return <div className="text-xs text-slate-500">暂无快照数据</div>;
  }

  const min = sorted[0].timestamp;
  const max = sorted[sorted.length - 1].timestamp;
  const currentIdx = selectedTimestamp
    ? sorted.findIndex((s) => s.timestamp === selectedTimestamp)
    : sorted.length - 1;

  const formatTime = (ts: number) =>
    new Date(ts * 1000).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>{formatTime(min)}</span>
        <span className="font-medium text-slate-200">
          {selectedTimestamp ? formatTime(selectedTimestamp) : formatTime(max)}
        </span>
        <span>{formatTime(max)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={sorted.length - 1}
        value={currentIdx >= 0 ? currentIdx : sorted.length - 1}
        onChange={(e) => {
          const idx = parseInt(e.target.value, 10);
          if (sorted[idx]) onSelect(sorted[idx].timestamp);
        }}
        className="w-full accent-accent-blue"
      />
      <div className="text-xs text-slate-500 text-center">
        共 {sorted.length} 个快照
      </div>
    </div>
  );
}
