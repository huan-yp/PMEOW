import type { Namespace } from "socket.io";
import type { AlertRecord, SecurityEventRecord, TaskEvent, UnifiedReport } from "@monitor/core";

export interface UIBroadcast {
  metricsUpdate(serverId: string, report: UnifiedReport): void;
  taskEvent(event: TaskEvent): void;
  alert(alert: AlertRecord): void;
  securityEvent(event: SecurityEventRecord): void;
  serverStatus(data: { serverId: string; status: string; lastSeenAt: number; version?: string }): void;
  serversChanged(): void;
}

export function createUIBroadcast(namespace: Namespace): UIBroadcast {
  return {
    metricsUpdate(serverId, report) {
      namespace.emit("metricsUpdate", { serverId, snapshot: report });
    },
    taskEvent(event) {
      namespace.emit("taskEvent", { serverId: event.serverId, eventType: event.eventType, task: event.task });
    },
    alert(alert) {
      namespace.emit("alert", { serverId: alert.serverId, alertType: alert.alertType, value: alert.value, threshold: alert.threshold });
    },
    securityEvent(event) {
      namespace.emit("securityEvent", event);
    },
    serverStatus(data) {
      namespace.emit("serverStatus", data);
    },
    serversChanged() {
      namespace.emit("serversChanged", {});
    },
  };
}
