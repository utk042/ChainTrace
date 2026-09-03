/**
 * Inlines a Vite build into one self-contained index.html.
 *
 * Scripts, styles and fonts are embedded, routing goes through the hash and
 * the app starts in offline snapshot mode, so the result runs from a file://
 * URL with no server, network or backend.
 *
 * Run via `npm run build:standalone`; expects `vite build --mode standalone`
 * to have written dist/ already.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const htmlPath = join(dist, 'index.html');

if (!existsSync(htmlPath)) {
  console.error('dist/index.html not found — run the vite build first.');
  process.exit(1);
}

let html = readFileSync(htmlPath, 'utf8');

// Fonts first: the CSS we inline below references them.
const fontDir = join(dist, 'fonts');
const fonts = existsSync(fontDir) ? readdirSync(fontDir).filter((f) => f.endsWith('.woff2')) : [];
const fontData = new Map(
  fonts.map((name) => [
    name,
    `data:font/woff2;base64,${readFileSync(join(fontDir, name)).toString('base64')}`,
  ]),
);

const inlineFonts = (css) =>
  css.replace(/url\((['"]?)[^'")]*\/fonts\/([^'")]+)\1\)/g, (match, _q, name) =>
    fontData.has(name) ? `url(${fontData.get(name)})` : match);

// Stylesheets
html = html.replace(
  /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/g,
  (match, href) => {
    const file = join(dist, href.replace(/^\.?\//, ''));
    if (!existsSync(file)) return match;
    return `<style>\n${inlineFonts(readFileSync(file, 'utf8'))}\n</style>`;
  },
);

// The standalone build sets inlineDynamicImports, so Vite emits one chunk.
const entryMatch = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"[^>]*><\/script>/);
if (!entryMatch) {
  console.error('No module script found in dist/index.html.');
  process.exit(1);
}

const assetDir = join(dist, 'assets');
const chunks = readdirSync(assetDir).filter((f) => f.endsWith('.js'));
if (chunks.length !== 1) {
  console.error(
    `Expected a single JS chunk, found ${chunks.length}: ${chunks.join(', ')}. ` +
    'The standalone build must set build.rollupOptions.output.inlineDynamicImports.',
  );
  process.exit(1);
}

// A literal `</script` anywhere in the bundle would close the tag we inline
// into and truncate the script. The escape is inert to the JS parser.
const escapeForInlineScript = (js) =>
  js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

const bundle = escapeForInlineScript(readFileSync(join(assetDir, chunks[0]), 'utf8'));

// Replacer functions, not strings: a string replacement interprets `$&` and
// `$1` inside the replacement, and minified React contains `.replace(R,"$&/")`.
html = html
  .replace(/<link[^>]+rel="modulepreload"[^>]*>/g, '')
  .replace(entryMatch[0], () => `<script type="module">\n${bundle}\n</script>`);

const outPath = join(dist, 'chaintrace-standalone.html');
writeFileSync(outPath, html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`Wrote ${outPath} (${kb} KB, ${fonts.length} fonts embedded)`);
