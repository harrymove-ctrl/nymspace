/**
 * One scroll lock for the whole document, counted rather than saved.
 *
 * Each full-screen overlay used to read `documentElement.style.overflow`, set
 * `hidden`, and put the old value back on cleanup. That is correct for one
 * overlay and wrong for two, which is what the app now has: the landing
 * preloader hands over to the console preloader through a window exactly as
 * long as its own fade, and for those ~420ms both are mounted. The second
 * captures `"hidden"` as the value to restore, the first releases to `""`, and
 * the second then re-applies `"hidden"` — permanently, with nothing on screen
 * to explain why the page will not scroll.
 *
 * Reproduced before this existed, which is why it is a counter: the lock is
 * held while anyone holds it and released once nobody does, and no caller has
 * to know whether it is the only one.
 *
 * The release is idempotent, because React re-runs an effect's cleanup under
 * StrictMode and an unbalanced count is the same bug in the other direction —
 * a lock released while an overlay is still covering the page.
 */

let depth = 0;
let saved: string | null = null;

export function lockScroll(): () => void {
  const root = document.documentElement;
  if (depth === 0) {
    saved = root.style.overflow;
    root.style.overflow = "hidden";
  }
  depth += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    depth -= 1;
    if (depth === 0) {
      root.style.overflow = saved ?? "";
      saved = null;
    }
  };
}
