import type { GpuCardReport, TaskInfo } from '../transport/types.js';
import { formatVramGB } from '../utils/vram.js';
import { FREE_COLOR, UNKNOWN_COLOR } from '../utils/ownerColor.js';
import { buildGpuOwnerGroups } from '../utils/gpuAllocation.js';

interface Props {
  gpu: GpuCardReport;
  tasks?: TaskInfo[];
  historical?: boolean;
}

function mixColor(color: string, target: string, amount: number): string {
  const source = color.replace('#', '');
  const destination = target.replace('#', '');
  if (source.length !== 6 || destination.length !== 6) {
    return color;
  }

  const red = Math.round(parseInt(source.slice(0, 2), 16) * (1 - amount) + parseInt(destination.slice(0, 2), 16) * amount);
  const green = Math.round(parseInt(source.slice(2, 4), 16) * (1 - amount) + parseInt(destination.slice(2, 4), 16) * amount);
  const blue = Math.round(parseInt(source.slice(4, 6), 16) * (1 - amount) + parseInt(destination.slice(4, 6), 16) * amount);

  return `rgb(${red}, ${green}, ${blue})`;
}

function getMutedOwnerColor(baseColor: string): string {
  return mixColor(baseColor, '#d9e1ec', 0.35);
}

function getReservedStripe(baseColor: string): string {
  const stripe = mixColor(baseColor, '#ffffff', 0.35);
  return `repeating-linear-gradient(135deg, ${stripe} 0 7px, ${baseColor} 7px 14px)`;
}

export function GpuBar({ gpu, tasks, historical = false }: Props) {
  const total = gpu.memoryTotalMb;
  if (total <= 0) return null;

  const { groups, unknownMb, totalDisplayedMb, freeMb } = buildGpuOwnerGroups(gpu, tasks, historical);
  const displayDenominator = Math.max(total, totalDisplayedMb, 1);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span className="font-mono">GPU {gpu.index}: {gpu.name}</span>
        <span className="text-slate-600">|</span>
        <span>{gpu.temperature}°C</span>
        <span className="text-slate-600">|</span>
        <span>利用率 {gpu.utilizationGpu}%</span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-dark-border bg-dark-bg/70">
        <div className="flex h-7 w-full overflow-hidden">
          {groups.map((group) => (
            <div key={`${group.key}-segments`} className="contents">
              {group.managedReservedMb > 0 && (
                <div
                  className="relative h-full border-r border-dark-border/60"
                  style={{ width: `${(group.managedReservedMb / displayDenominator) * 100}%`, backgroundColor: group.baseColor, backgroundImage: getReservedStripe(group.baseColor) }}
                  title={`${group.label} · 托管任务：已用 ${formatVramGB(group.managedActualMb)} / 预留 ${formatVramGB(group.managedReservedMb)}`}
                >
                  <div
                    className="absolute inset-y-0 left-0"
                    style={{ width: `${group.managedReservedMb > 0 ? (group.managedActualMb / group.managedReservedMb) * 100 : 0}%`, backgroundColor: group.baseColor }}
                  />
                </div>
              )}
              {group.unmanagedMb > 0 && (
                <div
                  className="h-full border-r border-dark-border/60"
                  style={{ width: `${(group.unmanagedMb / displayDenominator) * 100}%`, backgroundColor: getMutedOwnerColor(group.baseColor) }}
                  title={`${group.label} · 未托管进程：${formatVramGB(group.unmanagedMb)}`}
                />
              )}
            </div>
          ))}

          {unknownMb > 0 && (
            <div
              className="h-full border-r border-dark-border/60"
              style={{ width: `${(unknownMb / displayDenominator) * 100}%`, backgroundColor: UNKNOWN_COLOR }}
              title={`未知进程：${formatVramGB(unknownMb)}`}
            />
          )}

          {freeMb > 0 && (
            <div
              className="h-full flex-1"
              style={{ backgroundColor: FREE_COLOR }}
              title={`空闲：${formatVramGB(freeMb)}`}
            />
          )}
        </div>
      </div>

      <div className="flex justify-between text-[10px] text-slate-500 font-mono">
        <span>实际已用 {formatVramGB(gpu.memoryUsedMb)}</span>
        <span>调度可用 {formatVramGB(gpu.effectiveFreeMb)}</span>
        <span>总计 {formatVramGB(total)}</span>
      </div>

    </div>
  );
}
