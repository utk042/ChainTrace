import { createNodeImageProgram } from '@sigma/node-image';
import { CANVAS } from '../../theme';

/**
 * The Gotham node: a square pictogram tile with its label centred underneath.
 *
 * Sigma's stock renderer draws a coloured disc with the label off to the
 * right, which on a dense canvas gives you a field of identical dots and a
 * thicket of text streaming rightwards over the edges. Gotham's graph reads
 * because the tile tells you the object *type* at a glance and the label sits
 * directly under the thing it names.
 *
 * `drawingMode: 'background'` fills the tile with the node's colour and
 * composites the white pictogram over it, so risk tier still colours the
 * node and every existing colour reducer keeps working.
 */

/** Half-width of the drawn tile, as a fraction of the node's radius. */
const TILE_HALF = Math.SQRT1_2 * Math.cos(Math.PI / 12);

/** Label text, centred under the tile with a halo so it survives over edges. */
function drawLabel(context, data, settings) {
  if (!data.label) return;

  const size = settings.labelSize;
  const font = settings.labelFont;
  const weight = settings.labelWeight;

  context.font = `${weight} ${size}px ${font}`;
  const width = context.measureText(data.label).width;
  const x = data.x - width / 2;
  // Clear of the tile's own bottom edge, not of the node's bounding radius —
  // the tile is inscribed in that radius, so using it directly leaves a gap
  // that grows with node size and detaches the label from its node.
  const y = data.y + data.size * TILE_HALF + size + 3;

  // A stroked halo rather than a filled plate: it keeps the canvas reading as
  // a graph instead of a grid of chips, and still survives a label landing on
  // a bundle of edges.
  context.lineWidth = 3;
  context.lineJoin = 'round';
  context.strokeStyle = 'rgba(17, 20, 24, 0.9)';
  context.strokeText(data.label, x, y);

  context.fillStyle = settings.labelColor.color || CANVAS.label;
  context.fillText(data.label, x, y);
}

/** The same label, promoted: brighter, over a panel, with a tile outline. */
function drawHover(context, data, settings) {
  const size = settings.labelSize;
  const font = settings.labelFont;
  const weight = settings.labelWeight;

  // Ring the tile so the node under the cursor is unmistakable even where
  // several overlap.
  const half = data.size * TILE_HALF;
  context.strokeStyle = CANVAS.highlight;
  context.lineWidth = 2;
  context.strokeRect(data.x - half - 2, data.y - half - 2, half * 2 + 4, half * 2 + 4);

  if (!data.label) return;

  context.font = `${weight} ${size}px ${font}`;
  const width = context.measureText(data.label).width;
  const boxWidth = width + 12;
  const boxHeight = size + 8;
  const boxX = data.x - boxWidth / 2;
  const boxY = data.y + half + 4;

  context.fillStyle = CANVAS.hoverBg;
  context.strokeStyle = CANVAS.hoverBorder;
  context.lineWidth = 1;
  context.beginPath();
  context.rect(boxX, boxY, boxWidth, boxHeight);
  context.fill();
  context.stroke();

  context.fillStyle = CANVAS.hoverText;
  context.fillText(data.label, boxX + 6, boxY + size + 1);
}

/**
 * Built once for the app's single Sigma instance, so every node shares one
 * texture atlas — rebuilding it per instance is what the package warns about,
 * and there is only ever one canvas here.
 */
export const NodeTileProgram = createNodeImageProgram({
  drawingMode: 'background',
  keepWithinCircle: false,      // square tiles, not discs
  padding: 0.22,                // breathing room between glyph and tile edge
  size: { mode: 'force', value: 96 },
  objectFit: 'contain',
  correctCentering: true,
  drawLabel,
  drawHover,
});

export { drawLabel as drawNodeLabel, drawHover as drawNodeHover };
