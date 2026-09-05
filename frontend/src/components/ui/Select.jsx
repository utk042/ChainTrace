import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import Menu from './Menu';

/**
 * A dropdown that looks like the rest of the application.
 *
 * A native `<select>` renders its closed state with whatever CSS you give it
 * and its *open* list with the operating system's own widget — light-on-light
 * on some desktops, a different font on all of them, and nothing the app's
 * theme can reach. On a dark interface the open list was close to unreadable,
 * which is a poor way to present the filter that decides what evidence is on
 * screen.
 *
 * The trigger keeps the same class the `<select>` had, so the closed control
 * is unchanged; only the list is ours. Keyboard behaviour follows the native
 * one closely enough that nobody has to learn it: Enter, Space or the arrow
 * keys open it, the arrows and Home/End move, Enter picks, Escape closes.
 *
 * `options` is `[{ value, label, disabled? }]`. `onChange` is handed the
 * value, not an event — every call site read `e.target.value` and nothing
 * else.
 */
export default function Select({
  value,
  onChange,
  options = [],
  className = 'select',
  ariaLabel,
  title,
  disabled = false,
  placeholder = 'Select…',
}) {
  const current = options.find((o) => String(o.value) === String(value));

  return (
    <Menu
      align="left"
      matchWidth
      className="select-menu"
      trigger={({ toggle, open }) => (
        <SelectTrigger
          className={className}
          open={open}
          toggle={toggle}
          disabled={disabled}
          label={current ? current.label : placeholder}
          ariaLabel={ariaLabel}
          title={title}
        />
      )}
    >
      {({ close }) => (
        <SelectList
          options={options}
          value={value}
          close={close}
          onChange={onChange}
        />
      )}
    </Menu>
  );
}

function SelectTrigger({ className, open, toggle, disabled, label, ariaLabel, title }) {
  return (
    <button
      type="button"
      className={`${className} select-trigger${open ? ' open' : ''}`}
      onClick={toggle}
      // ArrowDown/Up opening the list is the one native behaviour people
      // reach for without thinking about it.
      onKeyDown={(e) => {
        if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
          e.preventDefault();
          toggle();
        }
      }}
      disabled={disabled}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-label={ariaLabel}
      title={title}
    >
      <span className="select-value">{label}</span>
      <Icon name="chevronDown" size={11} />
    </button>
  );
}

function SelectList({ options, value, close, onChange }) {
  const selectedIndex = Math.max(0, options.findIndex((o) => String(o.value) === String(value)));
  const [active, setActive] = useState(selectedIndex);
  const listRef = useRef(null);

  // Focus the list so the arrow keys reach it rather than scrolling the page
  // behind the menu.
  useEffect(() => { listRef.current?.focus(); }, []);

  const pick = useCallback((option) => {
    if (option.disabled) return;
    close();
    onChange?.(option.value);
  }, [close, onChange]);

  const move = useCallback((delta) => {
    setActive((i) => {
      const n = options.length;
      if (!n) return i;
      let next = i;
      // Step over disabled options rather than parking on one.
      for (let step = 0; step < n; step += 1) {
        next = (next + delta + n) % n;
        if (!options[next].disabled) return next;
      }
      return i;
    });
  }, [options]);

  return (
    <div
      className="select-list"
      role="listbox"
      tabIndex={-1}
      ref={listRef}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
        else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
        else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1); }
        else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (options[active]) pick(options[active]);
        }
      }}
    >
      {options.map((option, i) => {
        const selected = String(option.value) === String(value);
        return (
          <button
            key={`${option.value}`}
            type="button"
            role="option"
            aria-selected={selected}
            disabled={option.disabled}
            className={`select-option${selected ? ' selected' : ''}${i === active ? ' active' : ''}`}
            onMouseEnter={() => setActive(i)}
            onClick={() => pick(option)}
          >
            <span className="select-option-check">
              {selected && <Icon name="check" size={12} />}
            </span>
            <span className="select-option-label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
