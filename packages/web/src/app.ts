import fs from 'fs';
import { createServer, type Server as HttpServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import express, { type Express } from 'express';
import { getDatabase, Scheduler, type AgentSessionRegistry } from '@monitor/core';
import { loginHandler, authMiddleware, socketAuthMiddleware } from './auth.js';
import { setupAgentReadRoutes } from './agent-routes.js';
import { setupRestRoutes, setupSocketHandlers } from './handlers.js';
import { Server as SocketServer } from 'socket.io';
import { setupOperatorRoutes } from './operator-routes.js';
import { setupPersonRoutes } from './person-routes.js';
import {
  createAgentNamespace,
  type CreateAgentNamespaceOptions,
} from './agent-namespace.js';

const DEFAULT_PORT = Number(process.env.PORT) || 17200;
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export interface WebRuntime {
  app: Express;
  httpServer: HttpServer;
  io: SocketServer;
  scheduler: Scheduler;
  agentRegistry: AgentSessionRegistry;
  start: (port?: number) => Promise<number>;
  stop: () => Promise<void>;
}

export interface CreateWebRuntimeOptions {
  port?: number;
  publicDir?: string;
  scheduler?: Scheduler;
  agentNamespace?: CreateAgentNamespaceOptions;
}

function mountStaticAssets(app: Express, publicDir: string): void {
  if (!fs.existsSync(publicDir)) {
    return;
  }

  app.use(express.static(publicDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

export function createWebRuntime(options: CreateWebRuntimeOptions = {}): WebRuntime {
  getDatabase();

  const scheduler = options.scheduler ?? new Scheduler();
  const app = express();
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, {
    cors: { origin: '*' },
  });
  const uiNamespace = io.of('/');
  const agentNamespace = createAgentNamespace(io, scheduler, {
    ...options.agentNamespace,
    onTaskUpdate: (taskUpdate) => {
      options.agentNamespace?.onTaskUpdate?.(taskUpdate);
      uiNamespace.emit('taskUpdate', taskUpdate);
    },
  });

  let currentPort = options.port ?? DEFAULT_PORT;
  let started = false;
  let stoppingPromise: Promise<void> | null = null;

  app.use(cors());
  app.use(express.json());

  app.post('/api/login', loginHandler);
  app.use('/api', authMiddleware);

  setupRestRoutes(app, scheduler);
  setupAgentReadRoutes(app, {
    scheduler,
    agentRegistry: agentNamespace.registry,
  });
  setupOperatorRoutes(app, {
    scheduler,
    uiNamespace,
  });

  setupPersonRoutes(app);

  uiNamespace.use(socketAuthMiddleware);
  setupSocketHandlers(uiNamespace, scheduler);

  uiNamespace.on('connection', (socket) => {
    console.log(`[ws] client connected: ${socket.id}`);
    socket.on('disconnect', () => {
      console.log(`[ws] client disconnected: ${socket.id}`);
    });
  });

  mountStaticAssets(app, options.publicDir ?? path.join(moduleDir, 'public'));

  const start = async (port = currentPort): Promise<number> => {
    if (started) {
      return currentPort;
    }

    currentPort = port;

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        httpServer.off('listening', onListening);
        reject(error);
      };

      const onListening = () => {
        httpServer.off('error', onError);
        const address = httpServer.address();
        if (address && typeof address === 'object') {
          currentPort = address.port;
        }
        started = true;
        resolve();
      };

      httpServer.once('error', onError);
      httpServer.once('listening', onListening);
      httpServer.listen(currentPort);
    });

    scheduler.start();
    return currentPort;
  };

  const stop = async (): Promise<void> => {
    if (stoppingPromise) {
      return stoppingPromise;
    }

    stoppingPromise = (async () => {
      agentNamespace.stop();
      scheduler.stop();

      if (!httpServer.listening) {
        io.close();
        started = false;
        return;
      }

      await new Promise<void>((resolve) => {
        io.close(() => resolve());
      });

      if (httpServer.listening) {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      }

      started = false;
    })();

    try {
      await stoppingPromise;
    } finally {
      stoppingPromise = null;
    }
  };

  return {
    app,
    httpServer,
    io,
    scheduler,
    agentRegistry: agentNamespace.registry,
    start,
    stop,
  };
}