import { useEffect, useState } from 'react';
import Icon from '../Icon';
import { onUpdateAvailable, applyUpdate } from '../../services/offline';

/**
 * A newer build is cached and waiting.
 *
 * It is never applied silently: reloading mid-investigation would throw away
 * whatever is on screen — a selected node, a filtered alert list — so the
 * choice of when stays with the operator.
 */
export default function UpdatePrompt() {
  const [ready, setReady] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => onUpdateAvailable(() => setReady(true)), []);

  if (!ready) return null;

  return (
    <div className="update-prompt" role="status">
      <Icon name="boxDown" size={14} />
      <span>A newer version of ChainTrace is installed and ready.</span>
      <button
        className="btn btn-primary"
        disabled={applying}
        onClick={() => { setApplying(true); applyUpdate(); }}
      >
        {applying ? 'Reloading…' : 'Reload now'}
      </button>
      <button className="btn btn-outline" onClick={() => setReady(false)} aria-label="Dismiss">
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}
