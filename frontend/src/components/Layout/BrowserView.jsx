import Icon from '../Icon';
import { useResizablePane } from '../../hooks/useResizablePane';

/**
 * The three-pane Browser: filters, results, detail.
 *
 * Each pane scrolls independently and the detail pane is draggable, which is
 * what makes the layout usable for 64-character identifiers: the operator
 * widens the pane once and it stays that way.
 *
 * Below 1080px the filter pane becomes an overlay (toggled from the
 * toolbar); below 860px the detail pane does too. Nothing is ever squeezed
 * to the point of clipping.
 */
export default function BrowserView({
  id,
  filters,
  filtersTitle = 'Filters',
  showFilters,
  onCloseFilters,
  results,
  detail,
  detailWidth = 400,
}) {
  const { width, splitterProps } = useResizablePane(`${id}-detail`, {
    initial: detailWidth,
    min: 300,
    max: 720,
    edge: 'right',
  });

  return (
    <div
      className={`browser${detail ? ' has-detail' : ''}${showFilters ? ' show-filters' : ''}`}
      style={{ position: 'relative', '--pane-detail': `${width}px` }}
    >
      <aside className="browser-pane browser-filters" aria-label={filtersTitle}>
        <div className="browser-pane-head">
          <Icon name="filter" size={12} />
          <span className="truncate">{filtersTitle}</span>
          {onCloseFilters && (
            <span className="head-actions">
              <button
                type="button"
                className="icon-btn"
                onClick={onCloseFilters}
                aria-label="Hide filters"
              >
                <Icon name="collapseLeft" size={12} />
              </button>
            </span>
          )}
        </div>
        <div className="browser-scroll">{filters}</div>
      </aside>

      <section className="browser-pane browser-results">{results}</section>

      {detail && (
        <aside className="browser-pane browser-detail" style={{ position: 'relative' }}>
          <div {...splitterProps} className={`${splitterProps.className} splitter-edge`} />
          {detail}
        </aside>
      )}
    </div>
  );
}
