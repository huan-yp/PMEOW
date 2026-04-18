/**
 * Unified in-memory state store for all alert detectors.
 * Maintains persistent state across reports (e.g. duration tracking for GPU idle).
 * Lost on process restart — by design (first report re-computes from scratch).
 */
export class AlertStateStore {
  private state = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.state.get(key) as T | undefined;
  }

  set<T>(key: string, value: T): void {
    this.state.set(key, value);
  }

  delete(key: string): boolean {
    return this.state.delete(key);
  }

  /** Remove all keys matching a prefix (e.g. "serverId:"). */
  pruneByPrefix(prefix: string): void {
    for (const key of this.state.keys()) {
      if (key.startsWith(prefix)) {
        this.state.delete(key);
      }
    }
  }

  clear(): void {
    this.state.clear();
  }
}
