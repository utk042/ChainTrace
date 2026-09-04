import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Two build shapes:
 *
 *  - default: code-split, served from a web root.
 *  - standalone (`npm run build:standalone`): one chunk, no dynamic imports,
 *    relative asset paths, so scripts/build-standalone.mjs can fold it into
 *    a single self-contained HTML file.
 */
export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';

  return {
    plugins: [react()],
    base: standalone ? './' : '/',
    build: {
      rollupOptions: {
        output: standalone
          // A single file cannot resolve `import('./chunk.js')` at runtime.
          ? { inlineDynamicImports: true }
          : {
              // The two heavy visualisation libraries, split out so a page
              // pulls only what it uses and each caches independently.
              manualChunks: {
                sigma: ['sigma', 'graphology', 'graphology-layout-forceatlas2', '@react-sigma/core'],
                echarts: ['echarts', 'echarts-for-react'],
              },
            },
      },
      chunkSizeWarningLimit: standalone ? 6000 : 900,
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      allowedHosts: true,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
      },
    },
  };
});
