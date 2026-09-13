/**
 * A bounding rect read on layout and scroll rather than on every pointer move.
 *
 * Cloned verbatim from `canvas-ui` (`src/lib/rect-cache.ts`, MIT, David Haz),
 * which `bend-vanilla.ts` needs for its pointer tilt.
 */

export function createRectCache(element: Element) {
  let current = element.getBoundingClientRect();

  const refresh = () => {
    current = element.getBoundingClientRect();
  };

  const observer = new ResizeObserver(refresh);
  observer.observe(element);
  window.addEventListener("resize", refresh, { passive: true });
  window.addEventListener("scroll", refresh, {
    capture: true,
    passive: true,
  });

  return {
    get current() {
      return current;
    },
    destroy() {
      observer.disconnect();
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
    },
  };
}
