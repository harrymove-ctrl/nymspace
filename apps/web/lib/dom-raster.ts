/**
 * The UI, repainted into a canvas — without asking the browser for a new API.
 *
 * DecryptReveal's shader is the interesting half and it is not Chromium's:
 * `DecryptRevealVanilla.ts` samples a texture, matches each cell's ink to the
 * ASCII glyph whose shape fits, and reveals the sampled UI under the cursor.
 * All of that is plain WebGL2, and WebGL2 is everywhere.
 *
 * The Chromium-only part is one line — `drawElementImage`, the experimental
 * html-in-canvas call that turns a live subtree into pixels. That is the only
 * thing upstream uses it for, and it is a supplier of a texture, not a
 * participant in the effect. Replace the supplier and the whole thing runs in
 * Firefox and Safari exactly as it does in Chrome.
 *
 * So this file is the other supplier. It walks the subtree and repaints it with
 * Canvas2D: every element's background and border, every text node's real
 * characters in its real font and colour, at the rectangles layout has already
 * computed. No screenshot API, no `foreignObject` round trip, no library.
 *
 * ## What it is and is not
 *
 * It is not a renderer. It has no gradients, no shadows, no transforms, no
 * stacking-context ordering beyond tree order, no images. It is a faithful
 * *silhouette*: ink where the UI has ink, in the colour the UI has it, at the
 * position the UI has it — which is precisely and only what the glyph matcher
 * reads. A shadow the raster omits changes no glyph.
 *
 * The revealed circle shows this raster rather than the live DOM, which is the
 * same trade upstream makes, and the reason the list above is a list of things
 * to add if a screen ever needs them rather than a list of excuses. Today the
 * console is text, rules, borders and filled rects, and that is the set this
 * draws.
 *
 * ## Opaque on purpose
 *
 * The background is filled before anything else, so every pixel of the texture
 * has alpha 1. Upstream's shader carries the sampled alpha straight through to
 * its own output — with a transparent texture, the gaps between glyphs would be
 * transparent too and the live DOM would read straight through the cipher it is
 * supposed to be hidden behind. Painting the surface first is what makes the
 * veil opaque, and it is why this path needs no blur layer over the content.
 */

/** Elements whose subtree contributes nothing a glyph could be matched to. */
const SKIPPED = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD"]);

const TRANSPARENT = /^(transparent|rgba\(0,\s*0,\s*0,\s*0\))$/;

export interface DomRaster {
  /** The texture. Resized by {@link DomRaster.paint}. */
  readonly canvas: HTMLCanvasElement;
  /**
   * Repaint at the given device pixel ratio, sized to the root's box.
   * Returns false when the root has no box to paint yet.
   */
  paint: (dpr: number) => boolean;
}

export function createDomRaster(
  root: HTMLElement,
  background: string,
): DomRaster | null {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return null;

  /*
    One range, reused for every text node in every repaint.

    `document.createRange()` per node is the obvious shape and it is what made
    the first version take forty milliseconds on the chat console: a range is a
    live object the document tracks until it is collected, and a few thousand
    of them per paint is work the engine does on our behalf between frames.
  */
  const range = document.createRange();

  function paintText(node: Text, style: CSSStyleDeclaration, origin: DOMRect) {
    const value = node.nodeValue;
    if (!value || !value.trim()) return;

    range.selectNodeContents(node);
    const rects = range.getClientRects();
    if (rects.length === 0) return;

    ctx!.fillStyle = style.color;
    ctx!.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    ctx!.textBaseline = "middle";
    ctx!.textAlign = "left";

    /*
      One rect means one line box, and the whole string sits in it — the common
      case by a wide margin in a console of labels, cells and short sentences,
      and the one worth not paying for.

      More than one means the text wrapped, and the characters have to be
      apportioned to the lines that actually hold them. That is done by asking
      layout where each character is, which is a read per character; it runs
      only for wrapped text, only on a repaint, and only inside a loop that
      writes nothing, so the whole pass is a single layout rather than one per
      query.
    */
    if (rects.length === 1) {
      const rect = rects[0]!;
      ctx!.fillText(
        value,
        rect.left - origin.left,
        (rect.top + rect.bottom) / 2 - origin.top,
      );
      return;
    }

    let line = 0;
    let start = 0;
    for (let i = 0; i <= value.length; i++) {
      let moved = i === value.length;
      if (!moved) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const here = range.getBoundingClientRect();
        // A character below the current line's midpoint has wrapped onto the
        // next one. Comparing tops directly would misfire on a taller inline
        // sibling that shares the line.
        moved = here.top >= rects[line]!.bottom - 1;
      }
      if (!moved) continue;

      const rect = rects[Math.min(line, rects.length - 1)]!;
      ctx!.fillText(
        value.slice(start, i),
        rect.left - origin.left,
        (rect.top + rect.bottom) / 2 - origin.top,
      );
      start = i;
      line += 1;
      if (line >= rects.length) break;
    }
    range.selectNodeContents(node);
  }

  function paintBox(
    element: Element,
    style: CSSStyleDeclaration,
    origin: DOMRect,
  ) {
    const rect = element.getBoundingClientRect();
    if (rect.width < 0.5 || rect.height < 0.5) return;

    const x = rect.left - origin.left;
    const y = rect.top - origin.top;
    const radius = Math.min(
      parseFloat(style.borderTopLeftRadius) || 0,
      rect.width / 2,
      rect.height / 2,
    );

    const trace = () => {
      ctx!.beginPath();
      if (radius > 0) ctx!.roundRect(x, y, rect.width, rect.height, radius);
      else ctx!.rect(x, y, rect.width, rect.height);
    };

    if (!TRANSPARENT.test(style.backgroundColor)) {
      ctx!.fillStyle = style.backgroundColor;
      trace();
      ctx!.fill();
    }

    /*
      The top border stands in for all four.

      Reading each side separately doubles the computed-style work for a gain
      no glyph can express: a cell is ten pixels across and a one-pixel edge on
      three sides of it matches the same character as an edge on four. Where the
      console draws a rule on one side only — `frame-rule-below`, and the frame
      itself — it does it with a background image, which arrives as ink through
      the background branch above rather than through this one.
    */
    const width = parseFloat(style.borderTopWidth) || 0;
    if (width > 0 && style.borderTopStyle !== "none" &&
        !TRANSPARENT.test(style.borderTopColor)) {
      ctx!.strokeStyle = style.borderTopColor;
      ctx!.lineWidth = width;
      trace();
      ctx!.stroke();
    }
  }

  function walk(node: Node, origin: DOMRect) {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = (node as Text).parentElement;
      if (parent) paintText(node as Text, getComputedStyle(parent), origin);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as Element;
    if (SKIPPED.has(element.tagName)) return;

    const style = getComputedStyle(element);
    // `display: none` has no box and no children with boxes; `visibility` and
    // a zero opacity have boxes that paint nothing. Either way the subtree
    // contributes no ink, and descending into it is work for an empty result.
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return;
    }

    paintBox(element, style, origin);
    for (const child of element.childNodes) walk(child, origin);
  }

  return {
    canvas,

    paint(dpr) {
      const origin = root.getBoundingClientRect();
      if (origin.width < 1 || origin.height < 1) return false;

      const width = Math.max(1, Math.round(origin.width * dpr));
      const height = Math.max(1, Math.round(origin.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.fillStyle = background;
      ctx!.fillRect(0, 0, origin.width, origin.height);

      for (const child of root.childNodes) walk(child, origin);
      return true;
    },
  };
}
