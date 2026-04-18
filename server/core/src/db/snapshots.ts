import { getDatabase } from './database.js';
import type {
  UnifiedReport,
  SnapshotRecord,
  GpuSnapshotRecord,
  CpuSnapshot,
  MemorySnapshot,
  DiskInfo,
  DiskIoSnapshot,
  NetworkSnapshot,
  ProcessInfo,
  GpuCardReport,
  UserResourceSummary,
} from '../types.js';

export type SnapshotWithGpus = SnapshotRecord & { gpuSnapshots: GpuSnapshotRecord[] };

export function saveSnapshot(serverId: string, report: UnifiedReport, tier: 'recent' | 'archive', seq: number | null): number {
  const db = getDatabase();
  const snap = report.resourceSnapshot;

  const tx = db.transaction(() => {
    const res = db.prepare(
      `INSERT INTO snapshots (server_id, timestamp, tier, seq, cpu, memory, disks, disk_io, network, processes, processes_by_user, local_users)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      serverId,
      report.timestamp,
      tier,
      seq,
      JSON.stringify(snap.cpu),
      JSON.stringify(snap.memory),
      JSON.stringify(snap.disks),
      JSON.stringify(snap.diskIo),
      JSON.stringify(snap.network),
      JSON.stringify(snap.processes),
      JSON.stringify(snap.processesByUser),
      JSON.stringify(snap.localUsers),
    );

    const snapshotId = Number(res.lastInsertRowid);

    const gpuStmt = db.prepare(
      `INSERT INTO gpu_snapshots (
        snapshot_id, server_id, gpu_index, name, temperature, utilization_gpu, utilization_memory,
        memory_total_mb, memory_used_mb, managed_reserved_mb, unmanaged_peak_mb, effective_free_mb,
        task_allocations, user_processes, unknown_processes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const gpu of snap.gpuCards) {
      gpuStmt.run(
        snapshotId,
        serverId,
        gpu.index,
        gpu.name,
        gpu.temperature,
        gpu.utilizationGpu,
        gpu.utilizationMemory,
        gpu.memoryTotalMb,
        gpu.memoryUsedMb,
        gpu.managedReservedMb,
        gpu.unmanagedPeakMb,
        gpu.effectiveFreeMb,
        JSON.stringify(gpu.taskAllocations),
        JSON.stringify(gpu.userProcesses),
        JSON.stringify(gpu.unknownProcesses),
      );
    }

    return snapshotId;
  });

  return tx();
}

export function deleteOldRecentSnapshots(serverId: string, keepCount: number): void {
  const db = getDatabase();
  db.prepare(
    `DELETE FROM snapshots
     WHERE server_id = ? AND tier = 'recent' AND id NOT IN (
       SELECT id FROM snapshots
       WHERE server_id = ? AND tier = 'recent'
       ORDER BY timestamp DESC
       LIMIT ?
     )`
  ).run(serverId, serverId, keepCount);
}

export function getSnapshotHistory(serverId: string, from: number, to: number, tier?: 'recent' | 'archive'): SnapshotWithGpus[] {
  const db = getDatabase();
  let sql = 'SELECT * FROM snapshots WHERE server_id = ? AND timestamp >= ? AND timestamp <= ?';
  const params: unknown[] = [serverId, from, to];
  if (tier) {
    sql += ' AND tier = ?';
    params.push(tier);
  }
  sql += ' ORDER BY timestamp ASC';

  const snapshots = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return snapshots.map(s => {
    const gpuRows = db.prepare('SELECT * FROM gpu_snapshots WHERE snapshot_id = ?').all(s.id as number) as Record<string, unknown>[];
    return mapSnapshotRow(s, gpuRows);
  });
}

export function getLatestSnapshot(serverId: string): SnapshotWithGpus | undefined {
  const db = getDatabase();
  const s = db.prepare('SELECT * FROM snapshots WHERE server_id = ? ORDER BY timestamp DESC LIMIT 1').get(serverId) as Record<string, unknown> | undefined;
  if (!s) return undefined;

  const gpuRows = db.prepare('SELECT * FROM gpu_snapshots WHERE snapshot_id = ?').all(s.id as number) as Record<string, unknown>[];
  return mapSnapshotRow(s, gpuRows);
}

function mapSnapshotRow(s: Record<string, unknown>, gpuRows: Record<string, unknown>[]): SnapshotWithGpus {
  const gpuSnapshots = gpuRows.map(mapGpuRow);
  return {
    id: s.id as number,
    serverId: s.server_id as string,
    timestamp: s.timestamp as number,
    tier: s.tier as 'recent' | 'archive',
    seq: s.seq as number | null,
    cpu: JSON.parse(s.cpu as string) as CpuSnapshot,
    memory: JSON.parse(s.memory as string) as MemorySnapshot,
    disks: JSON.parse(s.disks as string) as DiskInfo[],
    diskIo: JSON.parse(s.disk_io as string) as DiskIoSnapshot,
    network: JSON.parse(s.network as string) as NetworkSnapshot,
    processes: JSON.parse(s.processes as string) as ProcessInfo[],
    processesByUser: JSON.parse((s.processes_by_user as string) || '[]') as UserResourceSummary[],
    localUsers: JSON.parse(s.local_users as string) as string[],
    gpuCards: gpuSnapshots.map(mapGpuSnapshotToCard),
    gpuSnapshots,
  };
}

function mapGpuRow(g: Record<string, unknown>): GpuSnapshotRecord {
  return {
    id: g.id as number,
    snapshotId: g.snapshot_id as number,
    serverId: g.server_id as string,
    gpuIndex: g.gpu_index as number,
    name: g.name as string,
    temperature: g.temperature as number,
    utilizationGpu: g.utilization_gpu as number,
    utilizationMemory: g.utilization_memory as number,
    memoryTotalMb: g.memory_total_mb as number,
    memoryUsedMb: g.memory_used_mb as number,
    managedReservedMb: g.managed_reserved_mb as number,
    unmanagedPeakMb: g.unmanaged_peak_mb as number,
    effectiveFreeMb: g.effective_free_mb as number,
    taskAllocations: g.task_allocations as string,
    userProcesses: g.user_processes as string,
    unknownProcesses: g.unknown_processes as string,
  };
}

function mapGpuSnapshotToCard(gpu: GpuSnapshotRecord): GpuCardReport {
  return {
    index: gpu.gpuIndex,
    name: gpu.name,
    temperature: gpu.temperature,
    utilizationGpu: gpu.utilizationGpu,
    utilizationMemory: gpu.utilizationMemory,
    memoryTotalMb: gpu.memoryTotalMb,
    memoryUsedMb: gpu.memoryUsedMb,
    managedReservedMb: gpu.managedReservedMb,
    unmanagedPeakMb: gpu.unmanagedPeakMb,
    effectiveFreeMb: gpu.effectiveFreeMb,
    taskAllocations: JSON.parse(gpu.taskAllocations) as GpuCardReport['taskAllocations'],
    userProcesses: JSON.parse(gpu.userProcesses) as GpuCardReport['userProcesses'],
    unknownProcesses: JSON.parse(gpu.unknownProcesses) as GpuCardReport['unknownProcesses'],
  };
}