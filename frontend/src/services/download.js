/**
 * Handing a generated file to the browser.
 *
 * Two things are easy to get wrong here and both fail silently:
 *
 *  - An anchor that is not in the document. Chrome dispatches the click
 *    anyway; Firefox ignores it, so the download never starts and nothing is
 *    logged.
 *  - Revoking the object URL on the next line. The download reads from that
 *    URL asynchronously, so revoking immediately is a race that shows up as
 *    an occasional empty or failed file rather than a reproducible bug.
 */

/** Trigger a download from any URL (object URL, data URL, or a real one). */
export function saveUrl(url, filename) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Trigger a download of in-memory data, releasing the URL once it is safe. */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  saveUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Timestamp suffix for exported filenames: 2026-09-04T12-32-53. */
export const fileStamp = (date = new Date()) =>
  date.toISOString().slice(0, 19).replace(/:/g, '-');
