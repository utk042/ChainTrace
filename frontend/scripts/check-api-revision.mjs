/**
 * Fails the build if the frontend and backend disagree about the API revision.
 *
 * The revision is what lets a running app say "the backend is older than this
 * interface" instead of rendering a half-populated response as if it were a
 * new bug — which is exactly the debugging detour it exists to prevent. That
 * only works while the two constants agree, and nothing else would notice
 * them drifting apart: the build would succeed, the app would look fine, and
 * the check would silently be measuring nothing.
 *
 * Run: npm run check:api-revision
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT = 'src/services/apiContract.js';
const BACKEND = '../backend/app/main.py';

const read = (relative) => {
  try {
    return readFileSync(join(ROOT, relative), 'utf8');
  } catch (err) {
    return null;
  }
};

const extract = (source, pattern, where) => {
  const match = pattern.exec(source);
  if (!match) {
    console.error(`check:api-revision — could not find the revision constant in ${where}.`);
    process.exit(1);
  }
  return Number(match[1]);
};

const hookSource = read(CONTRACT);
if (hookSource === null) {
  console.error(`check:api-revision — missing ${CONTRACT}.`);
  process.exit(1);
}
const frontend = extract(hookSource, /REQUIRED_API_REVISION\s*=\s*(\d+)/, CONTRACT);

const backendSource = read(BACKEND);
if (backendSource === null) {
  // A frontend-only checkout (a static build, a deploy artefact) has no
  // backend to compare against. Nothing is wrong; there is just nothing to
  // check, and failing the build here would block that build for no reason.
  console.log(`check:api-revision — frontend expects revision ${frontend}; `
    + 'no backend source in this checkout, skipping comparison.');
  process.exit(0);
}
const backend = extract(backendSource, /API_REVISION\s*=\s*(\d+)/, BACKEND);

if (frontend !== backend) {
  console.error(
    `check:api-revision — mismatch: ${CONTRACT} expects revision ${frontend}, `
    + `but ${BACKEND} serves ${backend}.\n`
    + 'Bump both together whenever a response shape the UI depends on changes; '
    + 'otherwise the app will report a current backend as out of date, or fail '
    + 'to report a genuinely stale one.',
  );
  process.exit(1);
}

console.log(`check:api-revision — frontend and backend agree on revision ${frontend}.`);
