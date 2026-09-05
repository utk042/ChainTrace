/**
 * The client-side query rules, checked against the routers they mirror.
 *
 * services/localQuery.js is what snapshot mode and an offline session use in
 * place of the backend's SQL. Two things have to hold: the filters mean what
 * the routers mean, and a locally-cut view never claims to describe more
 * rows than this device is holding.
 *
 * Run: npm run test:unit   (no browser, no build)
 */
import { queryList, sortRows, paginate, filterWallets, filterAlerts, filterTransactions } from '../src/services/localQuery.js';
import assert from 'node:assert/strict';

const wallets = [
  { address: 'aaa', anomaly_score: 10, risk_tier: 'Normal', peel_chain_depth: 0, mixer_interaction_count: 0, darknet_proximity_hops: null, tx_count: 5 },
  { address: 'bbb', anomaly_score: 90, risk_tier: 'Critical', peel_chain_depth: 3, mixer_interaction_count: 0, darknet_proximity_hops: null, tx_count: 1 },
  { address: 'ccc', anomaly_score: 50, risk_tier: 'High', peel_chain_depth: 0, mixer_interaction_count: 2, darknet_proximity_hops: 2, tx_count: 9 },
];

// default sort: anomaly_score desc
let r = queryList('/api/wallets', wallets, { page: 1, page_size: 2 }, 14318);
assert.deepEqual(r.wallets.map((w) => w.address), ['bbb', 'ccc']);
assert.equal(r.total, 14318, 'unfiltered view reports the backend total');
assert.equal(r.page_size, 2);

// page 2
r = queryList('/api/wallets', wallets, { page: 2, page_size: 2 }, 14318);
assert.deepEqual(r.wallets.map((w) => w.address), ['aaa']);

// explicit ascending sort
r = queryList('/api/wallets', wallets, { sort_by: 'tx_count', sort_order: 'asc', page: 1, page_size: 10 }, 14318);
assert.deepEqual(r.wallets.map((w) => w.address), ['bbb', 'aaa', 'ccc']);

// a filtered view reports what the filter matched here, never the backend total
r = queryList('/api/wallets', wallets, { risk_tier: 'Critical', page: 1, page_size: 10 }, 14318);
assert.equal(r.total, 1);
assert.deepEqual(r.wallets.map((w) => w.address), ['bbb']);

// a filter matching every row held here has still not been run against the
// rows that are not, so it must not borrow the backend's total either
r = queryList('/api/wallets', wallets, { min_score: 1, page: 1, page_size: 10 }, 14318);
assert.equal(r.wallets.length, 3);
assert.equal(r.total, 3, 'a filter never reports the whole-table total');

// paging and sorting are not filters, so they keep the backend's total
r = queryList('/api/wallets', wallets, { page: 1, page_size: 10, sort_by: 'tx_count', sort_order: 'asc' }, 14318);
assert.equal(r.total, 14318);

// an empty filter value is not a filter
r = queryList('/api/wallets', wallets, { page: 1, page_size: 10, risk_tier: '' }, 14318);
assert.equal(r.total, 14318);

// pattern filters mirror the router
assert.deepEqual(filterWallets(wallets, { pattern: 'peel_chain' }).map((w) => w.address), ['bbb']);
assert.deepEqual(filterWallets(wallets, { pattern: 'mixer' }).map((w) => w.address), ['ccc']);
assert.deepEqual(filterWallets(wallets, { pattern: 'watchlist' }).map((w) => w.address), ['ccc']);
assert.deepEqual(filterWallets(wallets, { search: 'BB' }).map((w) => w.address), ['bbb']);
assert.deepEqual(filterWallets(wallets, { min_score: 60 }).map((w) => w.address), ['bbb']);

// alerts: search covers the description, as the backend's does
const alerts = [
  { alert_id: '1', entity_id: 'x', description: 'peel chain detected', confidence: 0.9, risk_tier: 'Critical', status: 'pending' },
  { alert_id: '2', entity_id: 'y', description: 'mixer contact', confidence: 0.4, risk_tier: 'High', status: 'resolved' },
];
assert.deepEqual(filterAlerts(alerts, { search: 'PEEL' }).map((a) => a.alert_id), ['1']);
assert.deepEqual(filterAlerts(alerts, { status: 'resolved' }).map((a) => a.alert_id), ['2']);
assert.deepEqual(filterAlerts(alerts, { min_confidence: 0.5 }).map((a) => a.alert_id), ['1']);

// transactions: txid / src_ip / dst_ip
const txs = [
  { txid: 'abc', src_ip: '1.1.1.1', dst_ip: '2.2.2.2', script_type: 'P2PKH', timestamp: '2023-01-02' },
  { txid: 'def', src_ip: '3.3.3.3', dst_ip: '4.4.4.4', script_type: 'P2TR', timestamp: '2023-01-01' },
];
assert.deepEqual(filterTransactions(txs, { search: '3.3.3' }).map((t) => t.txid), ['def']);
assert.deepEqual(filterTransactions(txs, { script_type: 'P2TR' }).map((t) => t.txid), ['def']);
assert.deepEqual(queryList('/api/transactions', txs, {}, 4970).transactions.map((t) => t.txid), ['abc', 'def']);

// nulls sort last in both directions, so a missing value never reads as a small one
const withNulls = [{ a: 1 }, { a: null }, { a: 3 }];
assert.deepEqual(sortRows(withNulls, { sort_by: 'a', sort_order: 'asc' }).map((r2) => r2.a), [1, 3, null]);
assert.deepEqual(sortRows(withNulls, { sort_by: 'a', sort_order: 'desc' }).map((r2) => r2.a), [3, 1, null]);

// paginate guards nonsense params rather than returning a negative slice
assert.equal(paginate(wallets, { page: 0, page_size: 0 }, 'wallets').wallets.length, 1);

console.log('localQuery: all assertions passed');
