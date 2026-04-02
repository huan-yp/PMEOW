import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { getDatabase, Scheduler } from '@monitor/core';
import { loginHandler, authMiddleware, socketAuthMiddleware } from './auth.js';
import { setupSocketHandlers, setupRestRoutes } from './handlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 17200;

// ---- Init database ----
getDatabase();

// ---- Express ----
const app = express();
app.use(cors());
app.use(express.json());

// ---- Public auth routes ----
app.post('/api/login', loginHandler);

// ---- Protected routes ----
app.use('/api', authMiddleware);

// ---- HTTP server + Socket.IO ----
const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
  cors: { origin: '*' },
});

io.use(socketAuthMiddleware);

// ---- Core scheduler ----
const scheduler = new Scheduler();

// Setup REST routes + Socket.IO event forwarding
setupRestRoutes(app, scheduler);
setupSocketHandlers(io, scheduler);

io.on('connection', (socket) => {
  console.log(`[ws] client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`[ws] client disconnected: ${socket.id}`);
  });
});

// ---- Serve static UI (production only) ----
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

// ---- Start ----
scheduler.start();

httpServer.listen(PORT, () => {
  console.log(`[monitor] Web server running at http://localhost:${PORT}`);
});

// Graceful shutdown
const shutdown = () => {
  console.log('[monitor] Shutting down...');
  scheduler.stop();
  httpServer.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
