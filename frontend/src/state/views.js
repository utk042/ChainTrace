/**
 * The applications this workstation can open.
 *
 * One table drives the icon rail, the workspace tabs and the Window menu, so
 * a view cannot appear in one and be missing from another.
 */
export const VIEWS = [
  {
    key: 'overview',
    path: '/',
    label: 'Overview',
    icon: 'grid',
    hint: 'Case summary, volume and prioritised alerts',
  },
  {
    key: 'alerts',
    path: '/alerts',
    label: 'Alerts',
    icon: 'alertTriangle',
    hint: 'Model findings, triage and disposition',
    badge: 'alerts',
  },
  {
    key: 'wallets',
    path: '/wallets',
    label: 'Wallets',
    icon: 'wallet',
    hint: 'Wallet features, risk and counterparties',
  },
  {
    key: 'transactions',
    path: '/transactions',
    label: 'Transactions',
    icon: 'swap',
    hint: 'Transaction records, inputs and outputs',
  },
  {
    key: 'graph',
    path: '/graph',
    label: 'Graph',
    icon: 'graph',
    hint: 'Link analysis over the entity graph',
  },
  {
    key: 'ingest',
    path: '/ingest',
    label: 'Ingest',
    icon: 'uploadCloud',
    hint: 'Load data and run the analysis pipeline',
  },
  {
    key: 'settings',
    path: '/settings',
    label: 'Settings',
    icon: 'settings',
    hint: 'Thresholds, watchlist, offline and system',
  },
];

/** The view a pathname belongs to. Falls back to the overview. */
export function viewForPath(pathname) {
  if (pathname === '/') return VIEWS[0];
  return VIEWS.find((v) => v.path !== '/' && pathname.startsWith(v.path)) || VIEWS[0];
}
