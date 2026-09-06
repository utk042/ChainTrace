/**
 * What an edge means, and which way it points.
 *
 * The entity graph is undirected, because Louvain clustering, the embeddings
 * and risk propagation all need it that way. Direction is therefore not a
 * property of the edge — it is implied by the relationship:
 *
 *   wallet_input    a wallet paying into a transaction   wallet → tx
 *   wallet_output   a transaction paying out to a wallet tx → wallet
 *   co_input        two wallets spent together           no direction
 *   ip_observed_tx  an address seen carrying a tx        no direction
 *
 * The backend now orders the endpoints for the first two. The bundled
 * snapshot was serialised before it did, so `orient` re-derives the ordering
 * from the node types either way; nothing downstream has to care which
 * produced the payload it is drawing.
 *
 * Only a flow gets an arrowhead. Putting one on a co-input edge would assert
 * that one wallet paid another, when all the heuristic says is that the two
 * were spent in the same transaction — a claim the data does not support and
 * the kind an investigator would act on.
 */

/** Relationships that move value, and so carry a direction. */
export const FLOW_TYPES = new Set(['wallet_input', 'wallet_output']);

export const isFlow = (edgeType) => FLOW_TYPES.has(edgeType);

/**
 * The layers a link can belong to, as the filter panel offers them.
 *
 * Payments are evidence; the rest is context the pipeline inferred or
 * observed. Being able to switch the context off is what lets an investigator
 * see the money on a graph that has any density to it at all.
 */
export const LINK_LAYERS = [
  {
    key: 'payment',
    label: 'Payments',
    hint: 'Value moving into and out of transactions. The evidence.',
    types: ['wallet_input', 'wallet_output', 'wallet_change'],
  },
  {
    key: 'network',
    label: 'IP observations',
    hint: 'An address was seen carrying a transaction. An observation, not a payment.',
    types: ['ip_observed_tx'],
  },
  {
    key: 'inference',
    label: 'Co-spend links',
    hint: 'Kept for graphs built before co-spending became an entity of its own.',
    types: ['co_input'],
  },
];

const LAYER_OF_TYPE = new Map(
  LINK_LAYERS.flatMap((layer) => layer.types.map((t) => [t, layer.key])),
);

/** Which filter layer an edge type belongs to. Unknown types read as payments
 *  rather than vanishing: a link nobody has classified is still a link. */
export const layerOf = (edgeType) => LAYER_OF_TYPE.get(edgeType) || 'payment';

/** Every layer on, which is what an unfiltered graph means. */
export const ALL_LAYERS = Object.fromEntries(LINK_LAYERS.map((l) => [l.key, true]));

/**
 * Money leaving a wallet is read differently from money arriving, so they do
 * not share a colour. Inferences stay muted: they are context, not evidence
 * of a payment.
 */
export const FLOW_COLORS = {
  // Out of a wallet, into a transaction.
  wallet_input: '#e0883c',
  // Out of a transaction, into a wallet.
  wallet_output: '#3fb27f',
  co_input: '#8a5a5f',
  ip_observed_tx: '#6d5f96',
  unknown: '#5f6b7c',
};

/**
 * Put an edge's endpoints in the order value moved.
 *
 * `typeOf` maps a node id to its node_type. Returns the edge unchanged when
 * it is not a flow, or when the node types do not identify a transaction end
 * — guessing would be worse than leaving it as it came.
 */
export function orient(edge, typeOf) {
  if (!isFlow(edge.edge_type)) return { source: edge.source, target: edge.target };

  const sourceType = typeOf(edge.source);
  const targetType = typeOf(edge.target);

  let wallet = null;
  let tx = null;
  if (sourceType === 'transaction' && targetType === 'wallet') { tx = edge.source; wallet = edge.target; }
  else if (targetType === 'transaction' && sourceType === 'wallet') { tx = edge.target; wallet = edge.source; }
  else return { source: edge.source, target: edge.target };

  return edge.edge_type === 'wallet_input'
    ? { source: wallet, target: tx }
    : { source: tx, target: wallet };
}

/** How a relationship reads in a sentence, from `entityId`'s side of it. */
export function describeEdge(edgeType, { fromEntity = false } = {}) {
  switch (edgeType) {
    case 'wallet_input':
      return fromEntity ? 'paid into this transaction' : 'wallet spent into transaction';
    case 'wallet_output':
      return fromEntity ? 'received from this transaction' : 'transaction paid out to wallet';
    case 'co_input':
      return 'spent together in one transaction (co-input heuristic — an inference, not a payment)';
    case 'wallet_change':
      return fromEntity
        ? 'funded this transaction and took change back from it'
        : 'wallet funded the transaction and received change';
    case 'ip_observed_tx':
      return 'this address was observed carrying the transaction';
    default:
      return 'related';
  }
}

/**
 * How nodes are drawn. Offered next to the layout control, because at
 * different densities different shapes are readable:
 *
 *   tile  the pictogram tile — the type is legible before you read anything,
 *         and best when there is room between nodes
 *   disc  the same pictogram in a circle, which keeps a visible gap where
 *         square corners would touch
 *   dot   a plain coloured point: no pictogram, but thousands of them stay
 *         distinct where any glyph would smear into a block
 */
export const NODE_SHAPES = [
  { key: 'tile', label: 'Pictogram tile' },
  { key: 'disc', label: 'Pictogram disc' },
  { key: 'dot', label: 'Plain dot' },
];
