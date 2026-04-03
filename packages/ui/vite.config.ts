import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5129,
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://localhost:17200',
      '/socket.io': {
        target: 'http://localhost:17200',
        ws: true,
      },
    },
  },
});
