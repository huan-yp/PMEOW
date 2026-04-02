import fs from 'fs';
import { createServer, type Server as HttpServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import express, { type Express } from 'express';
import { getDatabase, Scheduler } from '@monitor/core';
import { loginHandler, authMiddleware, socketAuthMiddleware } from './auth.js';
import { setupRestRoutes, setupSocketHandlers } from './handlers.js';
import { Server as SocketServer } from 'socket.io';

const DEFAULT_PORT = Number(process.env.PORT) || 17200;
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export interface WebRuntime {
  app: Express;
  httpServer: HttpServer;
  io: SocketServer;
  scheduler: Scheduler;
  start: (port?: number) => Promise<number>;
  stop: () => Promise<void>;
}

export interface CreateWebRuntimeOptions {
  port?: number;
  publicDir?: string;
  scheduler?: Scheduler;
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

  let currentPort = options.port ?? DEFAULT_PORT;
  let started = false;
  let stoppingPromise: Promise<void> | null = null;

  app.use(cors());
  app.use(express.json());

  app.post('/api/login', loginHandler);
  app.use('/api', authMiddleware);

  setupRestRoutes(app, scheduler);

  io.use(socketAuthMiddleware);
  setupSocketHandlers(io, scheduler);

  io.on('connection', (socket) => {
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
    start,
    stop,
  };
}