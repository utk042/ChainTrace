import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Every file under public/, as web paths, so the SW can precache them. */
function listPublicFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listPublicFiles(full, base));
    else out.push('/' + relative(base, full).split('\\').join('/'));
  }
  return out;
}

/**
 * Emits dist/sw.js from src/sw/service-worker.js with the precache manifest
 * of the build it just produced.
 *
 * Everything the app can load is precached, lazy route chunks and the 1.6 MB
 * offline snapshot included. That is a deliberate trade: this is a forensic
 * tool whose whole promise is that it opens on a disconnected machine, and a
 * route that only works while online is worse than a larger install.
 */
function chaintraceServiceWorker({ publicDir }) {
  return {
    name: 'chaintrace-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const bundled = Object.keys(bundle)
        .filter((name) => /\.(js|css|html)$/.test(name))
        .map((name) => '/' + name);

      // Fonts, icons and the manifest are copied verbatim by Vite and never
      // appear in the bundle graph, so they are enumerated from disk.
      let publicFiles = [];
      try {
        publicFiles = listPublicFiles(publicDir).filter((f) => !f.endsWith('/mark.svg') && !f.endsWith('/mark-maskable.svg'));
      } catch { /* no public dir */ }

      // The document is reachable by both names and the navigation handler
      // looks it up as /index.html, so seed both explicitly: vite:build-html
      // emits the HTML after this hook, so it is not in `bundle` yet.
      const precache = [...new Set(['/', '/index.html', ...bundled, ...publicFiles])].sort();

      const buildId = createHash('sha256')
        .update(precache.join('\n'))
        .digest('hex')
        .slice(0, 12);

      const template = readFileSync(join(publicDir, '..', 'src/sw/service-worker.js'), 'utf8');
      // Replacer functions, not strings: a literal replacement would
      // interpret `$&` inside the value. Global, because a single-occurrence
      // replace silently targets whichever mention comes first.
      const source = template
        .replaceAll('__BUILD_ID__', () => buildId)
        .replaceAll('__PRECACHE__', () => JSON.stringify(precache, null, 2));

      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
      this.info(`service worker: ${precache.length} files precached (build ${buildId})`);
    },
  };
}

/**
 * Two build shapes:
 *
 *  - default: code-split, served from a web root, with a service worker.
 *  - standalone (`npm run build:standalone`): one chunk, no dynamic imports,
 *    relative asset paths, so scripts/build-standalone.mjs can fold it into
 *    a single self-contained HTML file. A file:// document cannot register a
 *    service worker, and does not need one — it is already self-contained.
 */
export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';
  const publicDir = new URL('./public', import.meta.url).pathname;

  return {
    plugins: [
      react(),
      ...(standalone ? [] : [chaintraceServiceWorker({ publicDir })]),
    ],
    base: standalone ? './' : '/',
    build: {
      // Safari 15 / Chrome 90-era targets still parse the output; nothing
      // here needs top-level await or decorators.
      target: 'es2020',
      sourcemap: false,
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
      chunkSizeWarningLimit: standalone ? 6000 : 1700,
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
    preview: {
      host: '0.0.0.0',
      port: 4173,
      allowedHosts: true,
    },
  };
});
