import type { Namespace } from "socket.io";
import type { AlertStateChange, SecurityEventRecord, TaskEvent, UnifiedReport, Principal } from "@monitor/core";
import { canAccessServer, canAccessTask } from "@monitor/core";

export interface UIBroadcast {
  metricsUpdate(serverId: string, report: UnifiedReport): void;
  taskEvent(event: TaskEvent): void;
  alertStateChange(change: AlertStateChange): void;
  securityEvent(event: SecurityEventRecord): void;
  serverStatus(data: { serverId: string; status: string; lastSeenAt: number; version?: string }): void;
  serversChanged(): void;
}

export function createUIBroadcast(namespace: Namespace): UIBroadcast {
  function forEachSocket(fn: (socket: any, principal: Principal) => void): void {
    for (const [, socket] of namespace.sockets) {
      const principal = socket.data.principal as Principal | undefined;
      if (principal) {
        fn(socket, principal);
      }
    }
  }

  return {
    metricsUpdate(serverId, report) {
      forEachSocket((socket, principal) => {
        if (canAccessServer(principal, serverId)) {
          socket.emit("metricsUpdate", { serverId, snapshot: report });
        }
      });
    },
    taskEvent(event) {
      forEachSocket((socket, principal) => {
        if (canAccessTask(principal, event.serverId, event.task.user)) {
          socket.emit("taskEvent", { serverId: event.serverId, eventType: event.eventType, task: event.task });
        }
      });
    },
    alertStateChange(change) {
      // Alerts only go to admins for now
      forEachSocket((socket, principal) => {
        if (principal.kind === 'admin') {
          socket.emit("alertStateChange", {
            alert: change.alert,
            fromStatus: change.fromStatus,
            toStatus: change.toStatus,
          });
        }
      });
    },
    securityEvent(event) {
      // Security events only go to admins
      forEachSocket((socket, principal) => {
        if (principal.kind === 'admin') {
          socket.emit("securityEvent", event);
        }
      });
    },
    serverStatus(data) {
      forEachSocket((socket, principal) => {
        if (canAccessServer(principal, data.serverId)) {
          socket.emit("serverStatus", data);
        }
      });
    },
    serversChanged() {
      // All connected clients get server list changes
      namespace.emit("serversChanged", {});
    },
  };
}
