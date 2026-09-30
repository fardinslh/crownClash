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

const BALE_SDK_TAG = /[ \t]*<script src="https:\/\/tapi\.bale\.ai\/miniapp\.js[^"]*"><\/script>\r?\n?/;

// The Bale SDK answers every window "message" event with console.error, and
// Chrome tooling that mirrors console output via postMessage turns that into an
// endless error loop on a desktop dev page. Serve-only: production HTML is
// untouched, and ?platform=bale / ?bale_id keep the SDK for Bale testing.
const skipBaleSdkInDev = {
  name: 'skip-bale-sdk-in-dev',
  apply: 'serve' as const,
  transformIndexHtml(html: string, ctx: { originalUrl?: string }) {
    const params = new URL(ctx.originalUrl ?? '/', 'http://localhost').searchParams;
    if (params.get('platform') === 'bale' || params.has('bale_id')) return html;
    return html.replace(BALE_SDK_TAG, '');
  },
};

export default defineConfig({
  plugins: [skipBaleSdkInDev],
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
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
});
