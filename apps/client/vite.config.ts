import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  server: {
    host: '0.0.0.0',
    strictPort: true,
    fs: {
      strict: true,
      allow: [__dirname, resolve(__dirname, '../../packages/shared'), resolve(__dirname, '../../node_modules')],
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/bot-runs/**', '**/data/**', '**/*.db', '**/*.db-*'],
    },
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
      '/health': 'http://localhost:8080',
      '/metrics': 'http://localhost:8080',
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        game: resolve(__dirname, 'game.html'),
        painter: resolve(__dirname, 'painter.html'),
        board: resolve(__dirname, 'board.html'),
      },
    },
  },
});
