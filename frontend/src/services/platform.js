/**
 * Which modifier key this machine actually uses.
 *
 * The shortcut handlers accept Ctrl and Cmd alike, so the only thing that
 * varies is what the interface *claims*. A hard-coded ⌘ told every Windows
 * and Linux operator to press a key their keyboard does not have, which is
 * worse than showing no hint at all — the shortcut works, and the label says
 * it does not apply to them.
 */

const APPLE = /mac|iphone|ipad|ipod/i;

/** True on macOS and iOS, where the command key is the accelerator. */
export const isApple = (() => {
  if (typeof navigator === 'undefined') return false;
  // userAgentData is the non-deprecated source; userAgent/platform are the
  // fallback for browsers that do not expose it.
  const hinted = navigator.userAgentData?.platform;
  return APPLE.test(hinted || navigator.platform || navigator.userAgent || '');
})();

/** The accelerator's name for this platform: "⌘" or "Ctrl". */
export const MOD_KEY = isApple ? '⌘' : 'Ctrl';

/**
 * A shortcut label for one key: `shortcut('K')` -> "⌘K" or "Ctrl+K".
 *
 * Apple's convention joins modifiers to the key with no separator; every
 * other platform uses a plus.
 */
export const shortcut = (key) => (isApple ? `${MOD_KEY}${key}` : `${MOD_KEY}+${key}`);
