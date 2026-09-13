/**
 * The cipher field — a glyph veil that decodes under the cursor, in 2D.
 *
 * `lib/decrypt-reveal.ts` is the real thing and is what normally runs — with
 * `lib/dom-raster.ts` supplying its texture it needs nothing but WebGL2, so
 * there is no browser it is merely unavailable on. This file is for the case
 * where WebGL2 itself is not there: a blocklisted driver, a context the tab
 * cannot allocate, a very old engine. Rare, and not so rare that a screen
 * whose job is to withhold a console should simply appear unlocked on it.
 *
 * So this draws the same idea from the other direction. Upstream reads a
 * picture of the UI and picks the glyph whose shape matches; this one has no
 * picture and does not try to make one. It lays a grid of mutating ASCII over
 * the content and punches a hole at the cursor, while a CSS layer above the
 * content blurs everything that hole does not expose. The UI is never sampled,
 * so the glyphs carry no information about what is underneath — the cipher is
 * scenery, and the blur is what actually hides the screen.
 *
 * Two consequences worth stating plainly, because they are the difference
 * between this and the engine above rather than a shortfall in either:
 *
 *  - The glyphs do not trace the UI's shapes. Under DecryptReveal the cipher is
 *    a legible silhouette of the page; here it is even noise.
 *  - The reveal is a blur lifting, not characters resolving into pixels.
 *
 * What the two share is the part the gate needs: everything is illegible until
 * the cursor is near, the edge of the hole flickers, and nothing about it is
 * load-bearing for access. `inert` on the content is what withholds the
 * console; see `components/console/decrypt-gate.tsx`.
 */

export interface CipherFieldOptions {
  /** Decrypt radius around the cursor in CSS pixels. */
  radius?: number;
  /** Feather of the decrypt edge as a fraction of the radius (0 to 1). */
  softness?: number;
  /** Glyph cell height in CSS pixels. */
  cell?: number;
  /** Width of a glyph cell relative to its height. */
  aspect?: number;
  /** Characters the cipher is written in. */
  charset?: string;
  /** Cipher colour, as any CSS colour the canvas can parse. */
  color?: string;
  /** Opacity of a resting glyph (0 to 1). */
  opacity?: number;
  /** Width of the flicker band as a fraction of the radius (0 to 1). */
  edgeWidth?: number;
  /** Fraction of idle cells that keep mutating (0 to 1). */
  scramble?: number;
  /** Cipher mutations per second. */
  scrambleSpeed?: number;
  /** Seconds the hole takes to catch up with the cursor. */
  smoothing?: number;
}

export interface CipherFieldElements {
  /** The canvas the glyphs are painted on. Must cover `host`. */
  surface: HTMLCanvasElement;
  /**
   * The positioned container. It receives the pointer, and it carries the
   * `--cipher-*` custom properties the blur layer reads — so the hole in the
   * glyphs and the hole in the blur are one number, not two that agree.
   */
  host: HTMLElement;
}

export interface CipherFieldInstance {
  setOptions: (options: CipherFieldOptions) => void;
  /**
   * Hold the loop still, or let it run again. The glyph atlas and the painted
   * canvas survive, so the veil stays exactly as it was and resuming is free.
   * See the same method on `DecryptRevealInstance`, which this mirrors so the
   * two engines stay interchangeable to a caller.
   */
  setPaused: (paused: boolean) => void;
  destroy: () => void;
}

/** Printable ASCII minus the space, so no cell is ever blank. */
const CHARSET = Array.from({ length: 94 }, (_, i) =>
  String.fromCharCode(33 + i),
).join("");

const DEFAULTS: Required<CipherFieldOptions> = {
  radius: 170,
  softness: 0.55,
  cell: 13,
  aspect: 0.6,
  charset: CHARSET,
  color: "#4ade80",
  opacity: 0.72,
  edgeWidth: 0.22,
  scramble: 0.06,
  scrambleSpeed: 9,
  smoothing: 0.12,
};

/** Alpha steps the field quantises to, so a run of cells shares one state. */
const ALPHA_STEPS = 12;

const ATLAS_PAD = 2;

export function createCipherField(
  elements: CipherFieldElements,
  options: CipherFieldOptions = {},
): CipherFieldInstance | null {
  const { surface, host } = elements;
  const ctx = surface.getContext("2d", { alpha: true });
  if (!ctx) return null;

  let config = { ...DEFAULTS, ...options };

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = motionQuery.matches;

  /*
    Glyphs are drawn from an atlas rather than with `fillText` per cell.

    A console-sized veil is on the order of five thousand cells, and five
    thousand `fillText` calls a frame is where this stopped holding sixty. The
    atlas is painted once per charset/size/colour change; the loop below is
    then `drawImage` plus an occasional `globalAlpha`, which is the cheapest
    thing a 2D context does.
  */
  const atlas = document.createElement("canvas");
  const atlasCtx = atlas.getContext("2d");
  if (!atlasCtx) return null;

  let atlasCellW = 0;
  let atlasCellH = 0;
  let glyphs: string[] = [];

  let dpr = 1;
  let cols = 0;
  let rows = 0;
  /** One glyph index per cell. */
  let field = new Uint8Array(0);
  let gridDirty = true;
  let atlasDirty = true;

  /*
    Two positions, not one. `tx`/`ty` is where the cursor is; `x`/`y` is where
    the hole has got to. `active` is the same arrangement for the hole's
    existence, so it opens and closes rather than blinking on a pointerleave.
  */
  const pointer = { x: 0, y: 0, tx: 0, ty: 0, active: 0, target: 0 };

  let lastTime = performance.now();
  let raf = 0;
  let running = false;
  let visible = true;
  /** Held by the caller; `visible` is this file's own. See `decrypt-reveal`. */
  let paused = false;
  let destroyed = false;

  function cellSize() {
    const h = Math.max(4, config.cell);
    return { w: h * config.aspect, h };
  }

  function buildAtlas() {
    const { w, h } = cellSize();
    glyphs = Array.from(new Set(Array.from(config.charset))).slice(0, 255);
    if (glyphs.length === 0) glyphs = Array.from(CHARSET);

    atlasCellW = Math.ceil((w + ATLAS_PAD * 2) * dpr);
    atlasCellH = Math.ceil((h + ATLAS_PAD * 2) * dpr);
    atlas.width = atlasCellW * glyphs.length;
    atlas.height = atlasCellH;

    atlasCtx!.clearRect(0, 0, atlas.width, atlas.height);
    atlasCtx!.textAlign = "center";
    atlasCtx!.textBaseline = "middle";
    atlasCtx!.fillStyle = config.color;
    /*
      The stack is the one `--font-mono` resolves to, named here rather than
      read from the element: a canvas `font` shorthand takes a family list, and
      handing it a `var(--font-mono)` string silently falls back to sans —
      which reads as the cipher having the wrong metrics rather than as a
      missing font.
    */
    atlasCtx!.font = `${h * dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`;

    for (let i = 0; i < glyphs.length; i++) {
      atlasCtx!.fillText(
        glyphs[i]!,
        i * atlasCellW + atlasCellW / 2,
        atlasCellH / 2,
      );
    }
    atlasDirty = false;
  }

  function syncGrid() {
    const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    const deviceW = Math.max(1, Math.round(width * nextDpr));
    const deviceH = Math.max(1, Math.round(height * nextDpr));

    if (nextDpr !== dpr) {
      dpr = nextDpr;
      atlasDirty = true;
    }
    if (surface.width !== deviceW || surface.height !== deviceH) {
      surface.width = deviceW;
      surface.height = deviceH;
    }

    const { w, h } = cellSize();
    const nextCols = Math.max(1, Math.ceil(width / w));
    const nextRows = Math.max(1, Math.ceil(height / h));
    if (nextCols !== cols || nextRows !== rows) {
      cols = nextCols;
      rows = nextRows;
      field = new Uint8Array(cols * rows);
      for (let i = 0; i < field.length; i++) {
        field[i] = Math.floor(Math.random() * 255);
      }
    }
    gridDirty = false;
  }

  /** How much of the UI this cell exposes: 0 fully enciphered, 1 fully clear. */
  function exposure(dx: number, dy: number) {
    if (pointer.active < 1e-3) return 0;
    const dist = Math.hypot(dx, dy);
    const outer = config.radius;
    const inner = outer * (1 - Math.min(Math.max(config.softness, 0), 1));
    if (dist >= outer) return 0;
    if (dist <= inner) return pointer.active;
    const t = (outer - dist) / Math.max(outer - inner, 1e-4);
    // Smoothstep, so the edge has no visible ring where the ramp begins.
    return pointer.active * t * t * (3 - 2 * t);
  }

  function render() {
    if (atlasDirty) buildAtlas();

    const { w, h } = cellSize();
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.clearRect(0, 0, surface.width / dpr, surface.height / dpr);

    const band = config.radius * config.edgeWidth;
    const inner = config.radius * (1 - Math.min(Math.max(config.softness, 0), 1));
    const glyphCount = glyphs.length;
    let alpha = -1;

    for (let row = 0; row < rows; row++) {
      const cy = row * h + h / 2;
      for (let col = 0; col < cols; col++) {
        const cx = col * w + w / 2;
        const clear = exposure(cx - pointer.x, cy - pointer.y);
        if (clear > 0.985) continue;

        const index = row * cols + col;
        let glyph = field[index]! % glyphCount;

        /*
          The flicker band. Cells on the wavefront re-roll every frame and burn
          brighter, which is what makes the hole read as something decoding
          rather than as a spotlight sliding over a texture. It is drawn from
          the frame's own randomness and never written back to `field`, so the
          band leaves no trail behind the cursor.
        */
        const dist = Math.hypot(cx - pointer.x, cy - pointer.y);
        const onEdge =
          pointer.active > 1e-3 && dist >= inner && dist <= inner + band;
        let boost = 0;
        if (onEdge && !reducedMotion) {
          glyph = Math.floor(Math.random() * glyphCount);
          boost = 0.28 * (1 - Math.abs(dist - inner - band / 2) / (band / 2 || 1));
        }

        const next =
          Math.round(
            (config.opacity * (1 - clear) + boost) * ALPHA_STEPS,
          ) / ALPHA_STEPS;
        if (next <= 0) continue;
        if (next !== alpha) {
          alpha = next;
          ctx!.globalAlpha = Math.min(alpha, 1);
        }

        ctx!.drawImage(
          atlas,
          glyph * atlasCellW,
          0,
          atlasCellW,
          atlasCellH,
          cx - (w / 2 + ATLAS_PAD),
          cy - (h / 2 + ATLAS_PAD),
          w + ATLAS_PAD * 2,
          h + ATLAS_PAD * 2,
        );
      }
    }
    ctx!.globalAlpha = 1;
  }

  /** Mutate the resting field, so the cipher is never a still photograph. */
  function churn(delta: number) {
    if (reducedMotion || config.scramble <= 0 || config.scrambleSpeed <= 0) {
      return;
    }
    const count = Math.round(
      field.length * config.scramble * config.scrambleSpeed * delta,
    );
    for (let i = 0; i < count; i++) {
      field[Math.floor(Math.random() * field.length)] = Math.floor(
        Math.random() * 255,
      );
    }
  }

  /*
    The hole's position and radius go out as custom properties on the host,
    which is how the blur layer above the content knows where not to blur. One
    source for both holes: a second copy in JS that happened to agree today is
    a seam that opens the first time either is tuned.
  */
  function publish() {
    host.style.setProperty("--cipher-x", `${pointer.x}px`);
    host.style.setProperty("--cipher-y", `${pointer.y}px`);
    host.style.setProperty("--cipher-r", `${config.radius * pointer.active}px`);
    host.style.setProperty(
      "--cipher-r-inner",
      `${config.radius * (1 - config.softness) * pointer.active}px`,
    );
  }

  function frame(now: number) {
    if (destroyed) return;
    if (!visible || paused) {
      running = false;
      return;
    }

    const delta = Math.min((now - lastTime) / 1000, 1 / 30);
    lastTime = now;

    if (gridDirty) syncGrid();

    const tau = Math.max(config.smoothing, 1e-4);
    const k = reducedMotion ? 1 : 1 - Math.exp(-delta / tau);
    pointer.x += (pointer.tx - pointer.x) * k;
    pointer.y += (pointer.ty - pointer.y) * k;
    pointer.active += (pointer.target - pointer.active) * k;

    churn(delta);
    publish();
    render();

    const settled =
      Math.abs(pointer.tx - pointer.x) < 0.25 &&
      Math.abs(pointer.ty - pointer.y) < 0.25 &&
      Math.abs(pointer.target - pointer.active) < 1e-3;
    const churning =
      !reducedMotion &&
      ((config.scramble > 0 && config.scrambleSpeed > 0) || pointer.active > 1e-3);

    /*
      A veil that has settled and has nothing left to churn stops asking for
      frames. It sits over a page nobody is interacting with, which is the
      state it spends most of its life in.
    */
    if (settled && !churning) {
      pointer.x = pointer.tx;
      pointer.y = pointer.ty;
      pointer.active = pointer.target;
      running = false;
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (destroyed || running || !visible || paused) return;
    running = true;
    lastTime = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function onPointerMove(event: PointerEvent) {
    const rect = host.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    // A hole that is not open yet has no position worth easing away from, so
    // the first move places it rather than sweeping it in from the origin.
    if (pointer.target === 0 && pointer.active < 1e-3) {
      pointer.x = x;
      pointer.y = y;
    }
    pointer.tx = x;
    pointer.ty = y;
    pointer.target = 1;
    start();
  }

  function onPointerLeave() {
    pointer.target = 0;
    start();
  }

  function onMotionChange() {
    reducedMotion = motionQuery.matches;
    start();
  }

  const resize = new ResizeObserver(() => {
    gridDirty = true;
    // See the same guard in `decrypt-reveal`: a resize invalidates what is on
    // the canvas, and a paused engine would never repaint it.
    if (paused) {
      if (!destroyed && visible) render();
    } else {
      start();
    }
  });
  resize.observe(host);

  const intersection = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1]?.isIntersecting ?? true;
    if (visible) start();
  });
  intersection.observe(host);

  host.addEventListener("pointermove", onPointerMove, { passive: true });
  host.addEventListener("pointerleave", onPointerLeave, { passive: true });
  motionQuery.addEventListener("change", onMotionChange);

  syncGrid();
  publish();
  start();

  return {
    setOptions(next) {
      const previous = config;
      config = { ...config, ...next };
      if (
        previous.charset !== config.charset ||
        previous.color !== config.color ||
        previous.cell !== config.cell ||
        previous.aspect !== config.aspect
      ) {
        atlasDirty = true;
      }
      if (previous.cell !== config.cell || previous.aspect !== config.aspect) {
        gridDirty = true;
      }
      start();
    },
    setPaused(next) {
      if (paused === next) return;
      paused = next;
      if (paused) cancelAnimationFrame(raf);
      running = false;
      if (!paused) start();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      resize.disconnect();
      intersection.disconnect();
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerleave", onPointerLeave);
      motionQuery.removeEventListener("change", onMotionChange);
    },
  };
}
