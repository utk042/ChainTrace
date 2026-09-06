/**
 * Graph semantics: which way an edge points, and what it means.
 *
 * The entity graph is undirected — Louvain clustering, the embeddings and
 * risk propagation all need it that way — so direction is never stored on an
 * edge. It is re-derived from the relationship and the node types, in
 * components/Graph/edgeSemantics.js, and that derivation is the only thing
 * standing between an investigator and a canvas that draws a receipt as a
 * payment.
 *
 * Run: npm run test:unit
 */
import assert from 'node:assert/strict';
import {
  orient, isFlow, FLOW_TYPES, FLOW_COLORS, describeEdge, NODE_SHAPES,
} from '../src/components/Graph/edgeSemantics.js';

const typeOf = (id) => (id.startsWith('tx') ? 'transaction' : id.startsWith('ip') ? 'ip' : 'wallet');

// A spend points from the wallet to the transaction, however the endpoints
// arrived. The bundled snapshot was serialised before the backend ordered
// them, so both orderings have to come out the same way.
assert.deepEqual(orient({ source: 'w1', target: 'tx1', edge_type: 'wallet_input' }, typeOf),
  { source: 'w1', target: 'tx1' });
assert.deepEqual(orient({ source: 'tx1', target: 'w1', edge_type: 'wallet_input' }, typeOf),
  { source: 'w1', target: 'tx1' }, 'a reversed spend is corrected');

// A receipt points from the transaction to the wallet.
assert.deepEqual(orient({ source: 'tx1', target: 'w1', edge_type: 'wallet_output' }, typeOf),
  { source: 'tx1', target: 'w1' });
assert.deepEqual(orient({ source: 'w1', target: 'tx1', edge_type: 'wallet_output' }, typeOf),
  { source: 'tx1', target: 'w1' }, 'a reversed receipt is corrected');

// Relationships that are not payments keep the order they came in, because
// they have no direction to correct to.
assert.deepEqual(orient({ source: 'w2', target: 'w1', edge_type: 'co_input' }, typeOf),
  { source: 'w2', target: 'w1' });
assert.deepEqual(orient({ source: 'ip1', target: 'tx1', edge_type: 'ip_observed_tx' }, typeOf),
  { source: 'ip1', target: 'tx1' });

// Unknown node types are left alone rather than guessed at: an arrow pointing
// the wrong way is worse than no arrow.
const unknown = () => undefined;
assert.deepEqual(orient({ source: 'a', target: 'b', edge_type: 'wallet_input' }, unknown),
  { source: 'a', target: 'b' });

// Only movements of value are directed. An arrowhead on a co-input edge would
// assert that one wallet paid another, which the heuristic never claims.
assert.equal(isFlow('wallet_input'), true);
assert.equal(isFlow('wallet_output'), true);
assert.equal(isFlow('co_input'), false);
assert.equal(isFlow('ip_observed_tx'), false);
assert.equal(FLOW_TYPES.size, 2);

// In and out do not share a colour: which way the money went is the point.
assert.notEqual(FLOW_COLORS.wallet_input, FLOW_COLORS.wallet_output);
for (const key of ['wallet_input', 'wallet_output', 'co_input', 'ip_observed_tx', 'unknown']) {
  assert.match(FLOW_COLORS[key], /^#[0-9a-f]{6}$/i, `${key} has a colour`);
}

// The co-input wording has to name itself an inference wherever it appears.
assert.match(describeEdge('co_input'), /inference, not a payment/);
assert.match(describeEdge('wallet_input'), /spent into/);
assert.match(describeEdge('wallet_output'), /paid out/);
assert.equal(describeEdge('nonsense'), 'related');

// Every shape the control offers must name a registered node program.
assert.deepEqual(NODE_SHAPES.map((s) => s.key), ['tile', 'disc', 'dot']);
for (const shape of NODE_SHAPES) assert.ok(shape.label, `${shape.key} has a label`);

console.log('graph semantics: all assertions passed');
