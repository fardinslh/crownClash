import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@crown-clash/game-core': path.resolve(__dirname, '../../packages/game-core/src/index.ts')
    }
  },
  server: {
    port: 3000,
    host: true
  }
});
