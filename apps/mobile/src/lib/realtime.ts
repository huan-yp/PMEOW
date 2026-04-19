import { io, type Socket } from 'socket.io-client';
import {
  UI_SOCKET_EVENTS,
  type AlertStateChangeEvent,
  type SecurityEvent,
  type ServerStatus,
  type TaskEvent,
  type UnifiedReport,
} from '@pmeow/app-common';

interface MobileRealtimeCallbacks {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onConnectError?: (message: string) => void;
  onMetricsUpdate?: (serverId: string, report: UnifiedReport) => void;
  onServerStatus?: (status: ServerStatus) => void;
  onTaskEvent?: (event: TaskEvent) => void;
  onAlertStateChange?: (event: AlertStateChangeEvent) => void;
  onSecurityEvent?: (event: SecurityEvent) => void;
  onServersChanged?: () => void;
}

interface ConnectOptions {
  baseUrl: string;
  token: string;
  callbacks: MobileRealtimeCallbacks;
}

export class MobileRealtimeClient {
  private socket: Socket | null = null;

  connect(options: ConnectOptions): void {
    this.disconnect();

    console.info(`[mobile][realtime] connect start baseUrl="${options.baseUrl}" transport=websocket`);

    const socket = io(options.baseUrl, {
      auth: { token: options.token },
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
    });

    socket.on('connect', () => {
      console.info(`[mobile][realtime] connected baseUrl="${options.baseUrl}" socketId=${socket.id ?? 'unknown'}`);
      options.callbacks.onConnect?.();
    });

    socket.on('disconnect', (reason) => {
      console.info(`[mobile][realtime] disconnected baseUrl="${options.baseUrl}" reason=${reason}`);
      options.callbacks.onDisconnect?.();
    });

    socket.on('connect_error', (error: Error) => {
      console.warn(`[mobile][realtime] connect_error baseUrl="${options.baseUrl}" message=${error.message || '实时连接失败。'}`);
      options.callbacks.onConnectError?.(error.message || '实时连接失败。');
    });

    socket.on(UI_SOCKET_EVENTS.metricsUpdate, (payload: { serverId: string; report: UnifiedReport }) => {
      options.callbacks.onMetricsUpdate?.(payload.serverId, payload.report);
    });

    socket.on(UI_SOCKET_EVENTS.serverStatus, (status: ServerStatus) => {
      options.callbacks.onServerStatus?.(status);
    });

    socket.on(UI_SOCKET_EVENTS.taskEvent, (event: TaskEvent) => {
      options.callbacks.onTaskEvent?.(event);
    });

    socket.on(UI_SOCKET_EVENTS.alertStateChange, (event: AlertStateChangeEvent) => {
      options.callbacks.onAlertStateChange?.(event);
    });

    socket.on(UI_SOCKET_EVENTS.securityEvent, (event: SecurityEvent) => {
      options.callbacks.onSecurityEvent?.(event);
    });

    socket.on(UI_SOCKET_EVENTS.serversChanged, () => {
      options.callbacks.onServersChanged?.();
    });

    this.socket = socket;
  }

  disconnect(): void {
    if (!this.socket) {
      return;
    }

    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.socket = null;
  }
}