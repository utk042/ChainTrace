import { Component } from 'react';
import Icon from './Icon';

/**
 * Catches a render error in one route instead of blanking the whole app.
 *
 * A white screen tells an investigator nothing and loses whatever they were
 * looking at; this keeps the shell — and therefore the nav — alive, names
 * the failure, and lets them retry the page or move on to another one.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled error while rendering a page:', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="page-content fade-in">
        <div className="card" style={{ maxWidth: 680 }}>
          <div className="card-header">
            <span className="card-title" style={{ color: 'var(--accent-critical)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="alertTriangle" size={14} /> This page failed to render
            </span>
          </div>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 'var(--space-md)' }}>
            The rest of the app is unaffected — the navigation still works, and
            nothing that was loaded has been lost. If this repeats on the same
            page, the detail below is what to report.
          </p>
          <pre style={{
            background: 'var(--bg-tertiary)', padding: 'var(--space-md)', borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', overflowX: 'auto', marginBottom: 'var(--space-lg)',
          }}>{String(error?.stack || error)}</pre>
          <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>
            <Icon name="refresh" size={13} /> Retry this page
          </button>
        </div>
      </div>
    );
  }
}
