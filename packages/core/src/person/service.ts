import * as personBindingDb from '../db/person-bindings.js';
import * as snapshotDb from '../db/snapshots.js';
import * as taskDb from '../db/tasks.js';
import { GpuSnapshotRecord, TaskRecord } from '../types.js';

export function getPersonTimeline(personId: string, from: number, to: number): GpuSnapshotRecord[] {
  const bindings = personBindingDb.getBindingsByPersonId(personId);
  const result: GpuSnapshotRecord[] = [];

  for (const binding of bindings) {
    const snapshots = snapshotDb.getSnapshotHistory(binding.serverId, from, to);
    for (const snap of snapshots) {
      for (const gpu of snap.gpuSnapshots) {
        const userProcs = JSON.parse(gpu.userProcesses as string) as any[];
        if (userProcs.some(p => p.user === binding.systemUser)) {
          result.push(gpu);
        }
      }
    }
  }

  return result.sort((a, b) => a.id - b.id); // Simple sort
}

export function getPersonTasks(personId: string, page: number, limit: number): TaskRecord[] {
  const bindings = personBindingDb.getBindingsByPersonId(personId);
  let allTasks: TaskRecord[] = [];

  for (const binding of bindings) {
    const tasks = taskDb.getTasks({ serverId: binding.serverId, user: binding.systemUser });
    allTasks = allTasks.concat(tasks);
  }

  return allTasks
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice((page - 1) * limit, page * limit);
}
