import { defineConfig } from 'vite';
import path from 'path';
import { execSync } from 'child_process';

let commitHash = 'dev';
try {
  commitHash = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  // fallback if git is unavailable
}
const buildVersion = `v0.1.0-${commitHash}`;

export default defineConfig({
  define: {
    __BUILD_VERSION__: JSON.stringify(buildVersion),
  },
  resolve: {
    alias: {
      '@crown-clash/game-core': path.resolve(__dirname, '../../packages/game-core/src/index.ts'),
      '@crown-clash/platform': path.resolve(__dirname, '../../packages/platform/src/index.ts')
    }
  },
  server: {
    port: 3000,
    host: true
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
});
