import { useState } from 'react';
import Icon from '../Icon';

/**
 * Copy-to-clipboard with a confirmation the operator can actually see.
 *
 * `navigator.clipboard` is unavailable over plain HTTP and in some
 * locked-down browsers, which is exactly the deployment this tool targets —
 * so a failure says so instead of silently doing nothing.
 */
export default function CopyButton({ value, title = 'Copy', size = 13 }) {
  const [state, setState] = useState('idle');   // idle | copied | failed

  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(String(value ?? ''));
      setState('copied');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), 1600);
  };

  return (
    <button
      type="button"
      className="icon-btn"
      onClick={copy}
      title={state === 'failed' ? 'Clipboard unavailable in this browser' : title}
      aria-label={title}
      style={state === 'failed' ? { color: 'var(--risk-critical)' } : undefined}
    >
      <Icon name={state === 'copied' ? 'check' : state === 'failed' ? 'close' : 'copy'} size={size} />
    </button>
  );
}
