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
      <div className="page">
        <div className="page-scroll">
          <section className="panel" style={{ flex: 'none', maxWidth: 760 }}>
            <header className="panel-header">
              <span className="panel-title" style={{ color: 'var(--risk-critical)' }}>
                <Icon name="alertTriangle" size={13} /> This view failed to render
              </span>
            </header>
            <div className="panel-body pad col" style={{ gap: 'var(--space-md)' }}>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                The rest of the workstation is unaffected — the rail and menus still
                work, and nothing already loaded has been lost. If this repeats on the
                same view, the detail below is what to report.
              </p>
              <pre className="trace">{String(error?.stack || error)}</pre>
              <div className="row">
                <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>
                  <Icon name="refresh" size={12} /> Retry this view
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }
}
