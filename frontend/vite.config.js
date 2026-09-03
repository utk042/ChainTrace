import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split the two heavy visualisation libraries out of the main bundle.
        // They were shipping as one 1.7 MB chunk that every page had to
        // download before anything rendered — including the charts library on
        // the graph page and the graph library on the dashboard. Separate
        // chunks let the browser cache them independently and let a page pull
        // only what it uses, which matters most on the slow or offline links
        // this tool is meant to run over.
        manualChunks: {
          sigma: ['sigma', 'graphology', 'graphology-layout-forceatlas2', '@react-sigma/core'],
          echarts: ['echarts', 'echarts-for-react'],
        },
      },
    },
    chunkSizeWarningLimit: 900,
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
});
