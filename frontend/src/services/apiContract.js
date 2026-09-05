/**
 * The API revision this build of the frontend is written against.
 *
 * Kept in its own module with no imports so anything can read it without
 * pulling in axios or the snapshot: the status hook compares it against a
 * live backend, the snapshot adapter stamps it (in snapshot mode this build
 * *is* the backend, so it is current by definition), the offline test's stub
 * backend stamps it, and scripts/check-api-revision.mjs fails the build if it
 * drifts from API_REVISION in backend/app/main.py.
 *
 * Bump it here and in backend/app/main.py together whenever a response shape
 * the UI depends on changes.
 */
export const REQUIRED_API_REVISION = 2;
