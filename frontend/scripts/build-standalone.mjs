/**
 * Inlines a Vite build into one self-contained index.html.
 *
 * Produces a file that runs from a file:// URL with no server, no network and
 * no backend: scripts, styles and fonts are all embedded, routing goes through
 * the hash, and the app starts in offline snapshot mode. That makes the whole
 * interface something you can hand to someone as a single attachment, or open
 * on an air-gapped machine, which is exactly the deployment this tool is meant
 * for.
 *
 * Run via `npm run build:standalone` — it expects `vite build` to have already
 * written dist/ with the standalone env vars set.
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

// Fonts first: they are referenced from inside the CSS we are about to inline.
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
    // Returned from a replacer function, so `$` sequences in the CSS are
    // inserted literally rather than treated as replacement patterns.
    return `<style>\n${inlineFonts(readFileSync(file, 'utf8'))}\n</style>`;
  },
);

// Module script. The standalone build sets inlineDynamicImports, so Vite
// emits exactly one chunk and there is nothing to order or stitch.
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

// Any literal `</script` inside the bundle — in a string, a comment, or the
// bundled snapshot's data — would close the tag we are inlining into and
// truncate the script mid-statement. The escape is inert to the JS parser and
// invisible to the HTML one.
const escapeForInlineScript = (js) =>
  js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

const bundle = escapeForInlineScript(readFileSync(join(assetDir, chunks[0]), 'utf8'));

// The replacements below all pass a function rather than a string. A string
// replacement would interpret `$&`, `$1` and friends *inside the replacement*
// — and minified React contains `.replace(R,"$&/")`, so inlining it as a
// string literally substituted the script tag into React's own source and
// produced a file that failed to parse. A replacer function disables that
// substitution entirely.
html = html
  .replace(/<link[^>]+rel="modulepreload"[^>]*>/g, '')
  .replace(entryMatch[0], () => `<script type="module">\n${bundle}\n</script>`);

const outPath = join(dist, 'chaintrace-standalone.html');
writeFileSync(outPath, html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`Wrote ${outPath} (${kb} KB, ${fonts.length} fonts embedded)`);
