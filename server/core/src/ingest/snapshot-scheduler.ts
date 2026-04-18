export class SnapshotScheduler {
  private lastRecentAt = new Map<string, number>();
  private lastArchiveAt = new Map<string, number>();
  
  shouldWriteRecent(serverId: string, now: number, intervalSeconds: number): boolean {
    const last = this.lastRecentAt.get(serverId) || 0;
    return now - last >= intervalSeconds * 1000;
  }

  shouldWriteArchive(serverId: string, now: number, intervalSeconds: number): boolean {
    const last = this.lastArchiveAt.get(serverId) || 0;
    return now - last >= intervalSeconds * 1000;
  }

  markRecentWritten(serverId: string, now: number): void {
    this.lastRecentAt.set(serverId, now);
  }

  markArchiveWritten(serverId: string, now: number): void {
    this.lastArchiveAt.set(serverId, now);
  }
}
