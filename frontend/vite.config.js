import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Two build shapes:
 *
 *  - default: code-split, served from a web root.
 *  - standalone (`npm run build:standalone`): one chunk with no dynamic
 *    imports and relative asset paths, so scripts/build-standalone.mjs can
 *    fold it into a single self-contained HTML file that runs from file://
 *    with no server and no backend.
 */
export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';

  return {
    plugins: [react()],
    base: standalone ? './' : '/',
    build: {
      rollupOptions: {
        output: standalone
          // A single file cannot resolve `import('./chunk.js')` at runtime, so
          // everything — route chunks and the bundled snapshot included — has
          // to land in one chunk.
          ? { inlineDynamicImports: true }
          : {
              // Split the two heavy visualisation libraries out of the main
              // bundle. They were shipping as one 1.7 MB chunk that every page
              // had to download before anything rendered — including the charts
              // library on the graph page and the graph library on the
              // dashboard. Separate chunks let the browser cache them
              // independently and let a page pull only what it uses, which
              // matters most on the slow or offline links this tool runs over.
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
