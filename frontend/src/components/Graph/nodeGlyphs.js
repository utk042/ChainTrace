import { PATHS } from '../Icon';

/**
 * Entity pictograms for the graph canvas, as data-URI SVGs.
 *
 * Gotham draws each object as a square tile carrying a pictogram of its type,
 * with the label underneath — the type is legible before you read anything,
 * which is what makes a thousand-node canvas navigable. This builds those
 * pictograms from the same path table the UI icons come from, so a fixed
 * icon stays fixed everywhere and there is no second copy of the geometry to
 * drift.
 *
 * The glyph is drawn in the application's ink on a transparent ground, and
 * the node program runs in `background` drawing mode — so Sigma fills the
 * tile with the node's own colour and composites the pictogram over it. That
 * gives Gotham's light-tile/dark-pictogram reading at every risk tier from a
 * single image per type, and leaves the existing colour reducers (dimming,
 * path highlight, search match) working untouched. A dimmed node's tile goes
 * dark, which takes the pictogram with it — exactly what dimming should do.
 */

const GLYPH_FOR_TYPE = {
  wallet: 'wallet',
  transaction: 'swap',
  ip: 'globe',
  unknown: 'circleDot',
};

/** Rendered into the texture atlas at this size, then scaled down by the GPU. */
const RENDER_SIZE = 96;

function svgDataUri(iconName) {
  const geometry = PATHS[iconName] || PATHS.circleDot;
  const subpaths = Array.isArray(geometry) ? geometry : [geometry];
  // A 24-unit viewBox inset to 20 leaves the stroke clear of the tile edge
  // once the program's padding is applied.
  const paths = subpaths
    .map((d) => `<path d="${d}"/>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${RENDER_SIZE}" height="${RENDER_SIZE}">`
    + `<g fill="none" stroke="#111418" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`
    + '</svg>';
  // encodeURIComponent rather than base64: it stays readable in devtools and
  // avoids pulling in a base64 helper for an air-gapped build.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const CACHE = new Map();

/** The pictogram URI for an entity type. Built once per type, then reused. */
export function glyphFor(nodeType) {
  const icon = GLYPH_FOR_TYPE[nodeType] || GLYPH_FOR_TYPE.unknown;
  if (!CACHE.has(icon)) CACHE.set(icon, svgDataUri(icon));
  return CACHE.get(icon);
}

export const GLYPH_TYPES = Object.keys(GLYPH_FOR_TYPE);
