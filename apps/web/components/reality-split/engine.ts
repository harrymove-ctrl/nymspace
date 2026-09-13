import {
  ARRIVE,
  ARRIVE_DUR,
  BASELINE_FRAC,
  BOX_RADIUS,
  COLLAPSE_DUR,
  CYCLE_VARIANTS,
  DEPART,
  DEPART_DUR,
  DRIFT_D0,
  EMERGE_DUR,
  FIELD_FADE,
  FIT_PAD_X,
  FIT_PAD_Y,
  FONT_SIZE,
  HANDLE_R,
  HANDLE_R_GIANT,
  LOOP,
  PAD_X,
  PALETTE,
  PALETTES,
  POP_E,
  SCATTER_ANGLE,
  SCATTER_E,
  SCATTER_GAP,
  SCATTER_INNER,
  SCATTER_OUTER,
  SCATTER_RELAX_PASSES,
  SCATTER_SPREAD,
  SEAM_GAPS,
  SELECT_ALL_HOLD,
  SELECT_DIM,
  SELECT_FADE,
  SHAPE_INFLATE,
  SPRING_AMP,
  SPRING_DAMP,
  SPRING_FREQ,
  SQUIRCLE_N,
  T_POP,
  T_POP_END,
  T_SCATTER,
  T_SCATTER_END,
  T_SPLIT,
  T_SPREAD_END,
  T_ZOOM,
  T_ZOOM_END,
  TIGHTEN_IN,
  TIGHTEN_OUT,
  TRAIN,
  TRAIN_ALL,
  TRAIN_ARRIVE_FAST,
  TRAIN_ARRIVE_SLOW,
  TRAIN_DWELL_MIN,
  TRAIN_FIT,
  TRAIN_NORMALISE,
  TRAIN_OVERLAP,
  TRAV_E,
  VARIANTS,
  WORD,
  WORD_FIT,
  WORD_H,
  ZOOM,
  ZOOM_BLUR,
  ZOOM_E,
  ZOOM_FADE_IN,
  ZOOM_FADE_OUT,
  type BoxShape,
  type HandleShape,
  type Palette,
  type Variant,
} from "./params";

/**
 * Fritsch–Carlson monotone cubic spline through the measured control points.
 *
 * Monotone is the requirement, not an implementation detail: the measured
 * eases have a violent middle segment, and a Catmull-Rom through the same
 * points overshoots on both sides of it — the word visibly springs backwards
 * before the pop and past full size after it.
 */
function spline(pts: [number, number][]): (k: number) => number {
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const dx: number[] = [];
  const dy: number[] = [];
  const s: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(xs[i + 1] - xs[i]);
    dy.push(ys[i + 1] - ys[i]);
    s.push(dy[i] / dx[i]);
  }
  const m: number[] = [s[0]];
  for (let i = 1; i < n - 1; i++) {
    if (s[i - 1] * s[i] <= 0) m.push(0);
    else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      m.push((w1 + w2) / (w1 / s[i - 1] + w2 / s[i]));
    }
  }
  m.push(s[n - 2]);
  return (k: number) => {
    if (k <= 0) return ys[0];
    if (k >= 1) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && xs[i + 1] < k) i++;
    const h = dx[i];
    const u = (k - xs[i]) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    return (
      ys[i] * (2 * u3 - 3 * u2 + 1) +
      m[i] * h * (u3 - 2 * u2 + u) +
      ys[i + 1] * (-2 * u3 + 3 * u2) +
      m[i + 1] * h * (u3 - u2)
    );
  };
}

const scatterE = spline(SCATTER_E);
const zoomE = spline(ZOOM_E);
const travE = spline(TRAV_E);
const popE = spline(POP_E);

function mixHex(a: string, b: string, k: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) + ((((pb >> 16) & 255) - ((pa >> 16) & 255)) * k));
  const g = Math.round(((pa >> 8) & 255) + ((((pb >> 8) & 255) - ((pa >> 8) & 255)) * k));
  const bl = Math.round((pa & 255) + (((pb & 255) - (pa & 255)) * k));
  return `rgb(${r},${g},${bl})`;
}

const easeOutCubic = (k: number) => 1 - (1 - k) ** 3;
const clamp01 = (k: number) => Math.max(0, Math.min(1, k));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const smooth = (k: number) => {
  const c = clamp01(k);
  return c * c * (3 - 2 * c);
};

interface Piece {
  x: number;
  y: number;
  w: number;
  h: number;
  gx: number;
  gy: number;
  gs: number;
  hr: number;
  a?: number;
  blur?: number;
  sel?: number;
}

interface LetterMetrics {
  ch: string;
  cellL: number;
  cellR: number;
  drawX: number;
  gcx: number;
  gcy: number;
  tw: number;
  th: number;
}

export interface RealitySplitOptions {
  /** Any length — cells, seams, scatter and the inspection all derive from it. */
  word?: string;
  palette?: Palette | keyof typeof PALETTES;
  shape?: BoxShape;
  handleShape?: HandleShape;
  /** 0 keeps the reference square's proportions; 1 stretches to full card width. */
  scatterSpread?: number;
  /** Inspect every letter, or only the reference's four. */
  trainAll?: boolean;
  speed?: number;
  /** Varies the constellation without changing the word. Seed 0 is the reference. */
  seed?: number;
  /** The worlds to cycle through, one per pass. Empty plays one forever. */
  variants?: Variant[];
  /**
   * Fired once per pass, the frame the word has finished popping back whole.
   *
   * A caller that plays a single pass — a preloader handing over to a page —
   * wants that moment, not the wrap: the 0.6s hold afterwards exists to give a
   * variant somewhere to change hands, and a piece that plays once has no
   * variant waiting.
   */
  onPop?: () => void;
}

export class RealitySplit {
  ok = false;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private raf = 0;
  private running = false;
  private last = 0;
  private t = 0;

  private W = 0;
  private H = 0;
  private dpr = 1;

  private opts: RealitySplitOptions = {};
  private variants: Variant[] = [];
  private vi = 0;
  private word: string = WORD;
  private pal: Palette = PALETTE;
  private prevPal: Palette | null = null;
  private started = false;
  private shape: BoxShape = "rect";
  private handleShape: HandleShape = "circle";
  private seed = 0;
  private popped = false;

  private font = "";
  private fontPx = 0;
  /**
   * The reference's unit is the card's short side, which is the height for
   * every aspect the clip and the card use. A full-viewport overlay in
   * portrait is not one of those: "CONSOLE" at 178/700 of an 844px height is
   * 880px of glyph in a 390px-wide phone. `S` is the height reduced just far
   * enough that the assembled word fits the width — a no-op at the reference
   * proportions, and exact in one step because every length below is linear
   * in it.
   */
  private S = 0;
  private letters: LetterMetrics[] = [];
  private wordW = 0;
  private wordH = 0;
  private baseline = 0;

  constructor(canvas: HTMLCanvasElement, opts: RealitySplitOptions = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    if (!this.ctx) return;
    this.opts = opts;
    this.variants = opts.variants ?? (CYCLE_VARIANTS ? VARIANTS : []);
    this.applyVariant(0);
    this.resize();
    this.ok = true;
  }

  private resolvePalette(p: Palette | keyof typeof PALETTES | undefined): Palette {
    if (!p) return PALETTE;
    return typeof p === "string" ? (PALETTES[p] ?? PALETTE) : p;
  }

  private applyVariant(i: number) {
    const v: Variant = this.variants.length ? this.variants[i % this.variants.length] : {};
    this.prevPal = this.started ? this.pal : null;
    this.started = true;
    this.popped = false;
    this.vi = i;
    this.word = v.word ?? this.opts.word ?? WORD;
    this.pal = this.resolvePalette(v.palette ?? this.opts.palette);
    this.shape = v.shape ?? this.opts.shape ?? "rect";
    this.handleShape = v.handle ?? this.opts.handleShape ?? "circle";
    this.seed = v.seed ?? this.opts.seed ?? 0;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = r.width;
    this.H = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.measure();
    if (!this.running) this.draw(this.t);
  }

  private measure() {
    // One trial pass at the reference unit, purely to learn whether the
    // assembled word overflows the card; `layOut` is then re-run at the scale
    // that makes it fit. Exact in one step, because every length it produces
    // is linear in the scale it is given.
    this.layOut(this.H);
    const room = this.W * WORD_FIT;
    if (this.wordW > room) this.layOut((this.H * room) / this.wordW);
  }

  private layOut(S: number) {
    const ctx = this.ctx!;
    this.S = S;
    this.fontPx = FONT_SIZE * S;
    this.font = `700 ${this.fontPx}px Helvetica, Arial, sans-serif`;
    ctx.font = this.font;

    const textW = ctx.measureText(this.word).width;
    this.wordW = textW + 2 * PAD_X * S;
    this.wordH = WORD_H * S;
    this.baseline = BASELINE_FRAC * this.wordH;

    const padX = PAD_X * S;
    this.letters = [];
    this.trainZoomCache = null;
    this.slots = null;
    this.sched = null;
    this.layout = null;
    for (let i = 0; i < this.word.length; i++) {
      const ch = this.word[i];
      const pre = ctx.measureText(this.word.slice(0, i)).width;
      const adv = ctx.measureText(this.word.slice(0, i + 1)).width;
      const m = ctx.measureText(ch);
      const asc = m.actualBoundingBoxAscent ?? this.fontPx * 0.72;
      const desc = m.actualBoundingBoxDescent ?? 0;
      const bbL = m.actualBoundingBoxLeft ?? 0;
      const bbR = m.actualBoundingBoxRight ?? adv - pre;
      const drawX = padX + pre;

      const inkW = bbL + bbR;
      const inkH = asc + desc;
      this.letters.push({
        ch,
        cellL: i === 0 ? 0 : padX + pre,
        cellR: i === this.word.length - 1 ? this.wordW : padX + adv,
        drawX,
        gcx: drawX + (bbR - bbL) / 2,
        gcy: this.baseline + (desc - asc) / 2,
        // Measured off the glyph's own ink, never tabulated by character: the
        // shared fallback the reference used was narrower than a capital A or
        // M, so those letters hung outside their own selection boxes.
        tw: (inkW + FIT_PAD_X * this.fontPx) * SHAPE_INFLATE[this.shape],
        th: (inkH + FIT_PAD_Y * this.fontPx) * SHAPE_INFLATE[this.shape],
      });
    }
  }

  start() {
    if (this.running || !this.ok) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;

      const speed = this.opts.speed ?? 1;
      const loop = this.timeline().loop;
      const next = this.t + Math.min((now - this.last) / 1000, 0.1) * speed;

      // The hold with the word whole is the only place a variant can change
      // hands without anything visibly jumping, and layout is measured and
      // cached for one word — swapping mid-pass desyncs the cells from the
      // glyphs. So the swap fires exactly at the wrap and nowhere else.
      if (next >= loop && this.variants.length > 1) {
        this.applyVariant(this.vi + 1);
        this.measure();
      }
      this.t = next % loop;
      this.last = now;
      this.draw(this.t);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  renderStill() {
    this.draw(0);
  }

  destroy() {
    this.stop();
  }

  private wordRect(scale: number) {
    return {
      x: this.W / 2 - (this.wordW * scale) / 2,
      y: this.H / 2 - (this.wordH * scale) / 2,
      w: this.wordW * scale,
      h: this.wordH * scale,
    };
  }

  /**
   * The constellation, generated and keyed by index.
   *
   * `word[0]` parks dead centre, because the camera dives into dead centre and
   * the letter it magnifies must BE the letter the inspection opens on —
   * otherwise the train starts with a glyph swap at full zoom. The rest spiral
   * out on the golden angle, then relax apart using each glyph's real box size
   * with the centre letter pinned and every box clamped inside the card.
   * Deterministic, so a word always gives the same picture.
   */
  private layout: [number, number][] | null = null;
  private scatterLayout(): [number, number][] {
    if (this.layout) return this.layout;
    const n = this.letters.length;
    if (n === 0) return (this.layout = []);

    const span = this.H + (this.W - this.H) * (this.opts.scatterSpread ?? SCATTER_SPREAD);
    const cx = this.W / 2;
    const cy = this.H / 2;
    const gap = SCATTER_GAP * this.S;

    const pts: [number, number][] = [[cx, cy]];
    for (let i = 1; i < n; i++) {
      const k = n > 2 ? (i - 1) / (n - 2) : 0;

      // Seed 0 must be the measured layout exactly, so the jitter is
      // multiplied by a factor that is zero at seed 0: adding the knob cannot
      // perturb the reference composition. Any other seed rotates where the
      // spiral starts and nudges each radius, through a deterministic hash of
      // (seed, index) rather than Math.random — variation without randomness.
      const off = this.seed === 0 ? 0 : 1;
      const h = Math.sin((this.seed + 1) * 12.9898 + i * 78.233) * 43758.5453;
      const jitter = (h - Math.floor(h)) * off;
      const r = lerp(SCATTER_INNER, SCATTER_OUTER, k) * (1 - 0.12 * off + 0.24 * jitter);
      const a = i * SCATTER_ANGLE - Math.PI / 2 + this.seed * SCATTER_ANGLE;
      pts.push([cx + Math.cos(a) * r * span, cy + Math.sin(a) * r * this.H]);
    }

    const halfW = this.letters.map((L) => L.tw / 2);
    const halfH = this.letters.map((L) => L.th / 2);
    for (let pass = 0; pass < SCATTER_RELAX_PASSES; pass++) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = pts[j][0] - pts[i][0];
          const dy = pts[j][1] - pts[i][1];

          const ox = halfW[i] + halfW[j] + gap - Math.abs(dx);
          const oy = halfH[i] + halfH[j] + gap - Math.abs(dy);
          if (ox <= 0 || oy <= 0) continue;

          let px = 0;
          let py = 0;
          if (ox < oy) px = (dx < 0 ? -ox : ox) / 2;
          else py = (dy < 0 ? -oy : oy) / 2;

          // The centre letter is pinned: it is the one the camera dives into.
          if (i === 0) {
            pts[j][0] += px * 2;
            pts[j][1] += py * 2;
          } else {
            pts[i][0] -= px;
            pts[i][1] -= py;
            pts[j][0] += px;
            pts[j][1] += py;
          }
        }
      }

      for (let i = 1; i < n; i++) {
        pts[i][0] = Math.max(halfW[i] + gap, Math.min(this.W - halfW[i] - gap, pts[i][0]));
        pts[i][1] = Math.max(halfH[i] + gap, Math.min(this.H - halfH[i] - gap, pts[i][1]));
      }
    }
    return (this.layout = pts);
  }

  private target(li: number): [number, number] {
    return this.scatterLayout()[li] ?? [this.W / 2, this.H / 2];
  }

  private scatterPiece(li: number, t: number): Piece | null {
    const S = this.S;
    const L = this.letters[li];
    const word = this.wordRect(1);

    const spreadK =
      t < T_SPLIT ? 0 : easeOutCubic(clamp01((t - T_SPLIT) / (T_SPREAD_END - T_SPLIT)));

    // The split is not a scale: the seams open to three different measured
    // gaps while the row stays centred, hand slop and all.
    const seams = Math.max(this.letters.length - 1, 0);
    const gapAt = (i: number) => SEAM_GAPS[i % SEAM_GAPS.length];
    let cum = 0;
    for (let s = 0; s < li; s++) cum += gapAt(s);
    let total = 0;
    for (let s = 0; s < seams; s++) total += gapAt(s);
    const rowShift = (cum - total / 2) * S * spreadK;

    const sliceX = word.x + L.cellL + rowShift;
    const sliceW = L.cellR - L.cellL;
    const sliceGx = word.x + L.gcx + rowShift;
    const sliceCx = sliceX + sliceW / 2;

    if (t < T_SCATTER) {
      return {
        x: sliceX,
        y: word.y,
        w: sliceW,
        h: word.h,
        gx: sliceGx,
        gy: word.y + L.gcy,
        gs: 1,
        hr: HANDLE_R * S,
      };
    }

    const fly = scatterE(clamp01((t - T_SCATTER) / (T_SCATTER_END - T_SCATTER)));
    const tight = smooth(
      (clamp01((t - T_SCATTER) / (T_SCATTER_END - T_SCATTER)) - TIGHTEN_IN) /
        (TIGHTEN_OUT - TIGHTEN_IN),
    );
    const [tx, ty] = this.target(li);
    let cx = lerp(sliceCx, tx, fly);
    let cy = lerp(this.H / 2, ty, fly);
    const w = lerp(sliceW, L.tw, tight);
    const h = lerp(word.h, L.th, tight);

    let gox = lerp(sliceGx - sliceCx, 0, tight);
    let goy = lerp(L.gcy - this.wordH / 2, 0, tight);

    let gs = 1;
    let hr = HANDLE_R * S;
    if (t >= T_SCATTER_END) {
      // Quadratic in both distance and time — a slow explosion still breathing.
      const q = clamp01((t - T_SCATTER_END) / (T_ZOOM - T_SCATTER_END));
      const vx = tx - this.W / 2;
      const vy = ty - this.H / 2;
      const d = Math.hypot(vx, vy);
      if (d > 0) {
        const push = (d / (DRIFT_D0 * S)) * q * q;
        cx = tx + vx * push;
        cy = ty + vy * push;
      }
    }
    if (t >= T_ZOOM) {
      // The centre letter lands at exactly the size the train will hold it at,
      // so the handover into the inspection is not a jump.
      const zEnd = li === 0 ? this.letterZoom(L) : ZOOM;
      const z = 1 + (zEnd - 1) * zoomE(clamp01((t - T_ZOOM) / (T_ZOOM_END - T_ZOOM)));
      cx = this.W / 2 + (cx - this.W / 2) * z;
      cy = this.H / 2 + (cy - this.H / 2) * z;
      gs = z;
      gox *= z;
      goy *= z;
      hr *= this.handleGrow(t);
      const zw = w * z;
      const zh = h * z;
      if (cx + zw / 2 < 0 || cx - zw / 2 > this.W || cy + zh / 2 < 0 || cy - zh / 2 > this.H)
        return null;

      let a = 1;
      let blur = 0;
      if (li !== 0) {
        // The letters fade and defocus under the zoom rather than relying on it
        // to sweep them off: the measured 3.46x cleared the reference's wide
        // spread, but a generated constellation packs letters closer in, and
        // the nearest one kept a corner in frame for the whole dive and then
        // blinked out the instant the train took over.
        const k = clamp01((t - T_ZOOM) / (T_ZOOM_END - T_ZOOM));
        const f = smooth((k - ZOOM_FADE_IN) / (ZOOM_FADE_OUT - ZOOM_FADE_IN));
        a = 1 - f;
        if (a <= 0.002) return null;
        blur = f * ZOOM_BLUR * S;
      }
      return {
        x: cx - zw / 2,
        y: cy - zh / 2,
        w: zw,
        h: zh,
        gx: cx + gox,
        gy: cy + goy,
        gs,
        hr,
        a,
        blur,
      };
    }
    return { x: cx - w / 2, y: cy - h / 2, w, h, gx: cx + gox, gy: cy + goy, gs, hr };
  }

  /** Handles grow sub-linearly: boxes go 3.46x, handles stop at 30/700. */
  private handleGrow(t: number) {
    const k = zoomE(clamp01((t - T_ZOOM) / (T_ZOOM_END - T_ZOOM)));
    return 1 + (HANDLE_R_GIANT / HANDLE_R - 1) * k * k;
  }

  private trainIndex(ti: number): number {
    return this.trainSlots()[ti] ?? 0;
  }

  private slots: number[] | null = null;
  private trainSlots(): number[] {
    if (this.slots) return this.slots;
    const n = this.letters.length;
    if (n === 0) return (this.slots = [0, 0, 0, 0]);

    if (this.opts.trainAll ?? TRAIN_ALL) return (this.slots = this.letters.map((_, i) => i));

    // The reference's four, by name where the word has them and spread evenly
    // where it does not. Inspecting four of seven letters on four absolute
    // timings reads, on a custom word, as skipping letters at random — which
    // is why this is not the default.
    const used = new Set<number>();
    const out: number[] = [];
    for (let ti = 0; ti < TRAIN.length; ti++) {
      const byName = this.letters.findIndex((l, i) => l.ch === TRAIN[ti] && !used.has(i));
      let idx =
        byName >= 0
          ? byName
          : Math.min(n - 1, Math.round((ti / (TRAIN.length - 1)) * (n - 1)));
      let step = 0;
      while (used.has(idx) && step < n) {
        step++;
        idx = (idx + 1) % n;
      }
      used.add(idx);
      out.push(idx);
    }
    return (this.slots = out);
  }

  private sched: { arrive: number; arriveDur: number; depart: number }[] | null = null;
  private schedule() {
    if (this.sched) return this.sched;
    const slots = this.trainSlots();
    const n = slots.length;
    if (!(this.opts.trainAll ?? TRAIN_ALL) && n === TRAIN.length) {
      this.sched = slots.map((_, i) => ({
        arrive: i === 0 ? T_ZOOM_END : ARRIVE[i - 1],
        arriveDur: i === 0 ? 0 : ARRIVE_DUR[i - 1],
        depart: DEPART[i],
      }));
      return this.sched;
    }

    // The measured window holds exactly seven letters at this speed. Nine get
    // a longer piece at the same speed, not a faster piece: the dwell is a
    // floor and the loop stretches to fit the word.
    const refWindow = T_POP - T_ZOOM_END;
    const durAt = (i: number) =>
      lerp(TRAIN_ARRIVE_SLOW, TRAIN_ARRIVE_FAST, n > 1 ? i / (n - 1) : 0);

    const cost = (dwell: number) => {
      let total = 0;
      for (let i = 0; i < n; i++) {
        const overlap = i === 0 ? 0 : DEPART_DUR * TRAIN_OVERLAP;
        total += (i === 0 ? 0 : durAt(i)) + dwell + DEPART_DUR - overlap;
      }
      return total;
    };

    const slack = (refWindow - cost(0)) / n;
    const dwell = Math.max(TRAIN_DWELL_MIN, slack);

    let cursor = T_ZOOM_END;
    this.sched = slots.map((_, i) => {
      const arriveDur = i === 0 ? 0 : durAt(i);
      const arrive = cursor;
      const depart = arrive + arriveDur + dwell;
      cursor = depart + DEPART_DUR - DEPART_DUR * TRAIN_OVERLAP;
      return { arrive, arriveDur, depart };
    });
    return this.sched;
  }

  private timeline() {
    const sched = this.schedule();
    const last = sched[sched.length - 1];
    const trainEnd = last ? last.depart + DEPART_DUR : T_POP;
    const pop = Math.max(T_POP, trainEnd);
    const popEnd = pop + (T_POP_END - T_POP);
    const loop = pop + (LOOP - T_POP);
    const collapse = this.variants.length > 1 ? Math.max(popEnd, loop - COLLAPSE_DUR) : loop;
    return { pop, popEnd, collapse, loop };
  }

  private trainX(ti: number, t: number): number | null {
    const S = this.S;
    const L = this.letters[this.trainIndex(ti)];
    if (!L) return null;
    const halfW = (L.tw * this.letterZoom(L)) / 2;
    const center = this.W / 2;
    // One direction throughout: alternating sides was tried, and a zig-zag
    // reads as fidgeting rather than as a conveyor.
    const enterX = this.W + halfW;
    const exitX = -halfW - 0.05 * S;

    const sched = this.schedule();
    const slot = sched[ti];
    if (!slot) return null;

    let x = center;
    if (ti > 0) {
      if (t < slot.arrive) return null;
      const k = clamp01((t - slot.arrive) / slot.arriveDur);
      x = lerp(enterX, center, travE(k));
      // Carries about 12px past centre and rings down to rest inside the
      // arrival: at this speed a move that merely decelerates reads as a cut.
      const decay = Math.exp(-SPRING_DAMP * k);
      x -= Math.sin(SPRING_FREQ * k) * decay * SPRING_AMP * this.W;
    }
    if (t >= slot.depart) {
      x = lerp(center, exitX, travE(clamp01((t - slot.depart) / DEPART_DUR)));
      if (t >= slot.depart + DEPART_DUR) return null;
    }
    return x;
  }

  /**
   * How large the inspection holds a letter — derived, not the measured 3.46.
   *
   * `ZOOM` is not an independent constant. On the reference card the tallest
   * box is 174 of 700 and 700 × 0.86 / 174 = 3.4598, which is the measured
   * 3.46 to four figures: the clip's zoom *is* its fit-to-86%-of-the-card
   * value, and every card whose unit is its own height reproduces it to within
   * a rounding error. Capping at 3.46 was therefore a no-op exactly where it
   * was measured — and wrong everywhere else. A portrait viewport, where the
   * word has to be laid out below the card's height to fit its width, made
   * that visible: the letter the piece calls huge came out a quarter of the
   * screen tall. So the fit is the law and 3.46 is one of its outputs.
   *
   * `ZOOM` is still the literal figure for the letters sweeping out under the
   * dive, which only have to clear the frame and are transparent before they
   * do.
   */
  private trainZoomCache: number | null = null;
  private trainZoom(): number {
    if (this.trainZoomCache !== null) return this.trainZoomCache;
    let tallest = 0;
    let widest = 0;
    for (const L of this.letters) {
      if (L.th > tallest) tallest = L.th;
      if (L.tw > widest) widest = L.tw;
    }
    if (tallest <= 0) return (this.trainZoomCache = ZOOM);
    const byH = (this.H * TRAIN_FIT) / tallest;
    const byW = (this.W * TRAIN_FIT) / Math.max(widest, 1);
    return (this.trainZoomCache = Math.min(byH, byW));
  }

  /** Pulls each letter toward the same optical size, so an l is not a splinter. */
  private letterZoom(L: LetterMetrics): number {
    const z = this.trainZoom();
    if (TRAIN_NORMALISE <= 0) return z;
    let tallest = 0;
    for (const m of this.letters) if (m.th > tallest) tallest = m.th;
    if (tallest <= 0 || L.th <= 0) return z;
    const even = z * (tallest / L.th);
    return lerp(z, even, TRAIN_NORMALISE);
  }

  private trainPiece(ti: number, t: number): Piece | null {
    const x = this.trainX(ti, t);
    if (x === null) return null;
    const L = this.letters[this.trainIndex(ti)];
    if (!L) return null;
    const z = this.letterZoom(L);
    const w = L.tw * z;
    const h = L.th * z;
    return {
      x: x - w / 2,
      y: this.H / 2 - h / 2,
      w,
      h,
      gx: x,
      gy: this.H / 2,
      gs: z,
      hr: HANDLE_R_GIANT * this.S,
    };
  }

  private fillBox(x: number, y: number, w: number, h: number) {
    const ctx = this.ctx!;
    // `fillRect` rather than `rect()` + `fill()` for the rectangle case: the
    // two rasterise edge antialiasing differently, and the reference was
    // measured against this one.
    if (this.shape === "rect") {
      ctx.fillRect(x, y, w, h);
      return;
    }
    this.boxPath(x, y, w, h);
    ctx.fill();
  }

  private boxPath(x: number, y: number, w: number, h: number) {
    const ctx = this.ctx!;
    ctx.beginPath();
    if (this.shape === "ellipse") {
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      return;
    }
    if (this.shape === "round") {
      const r = Math.min(w, h) * BOX_RADIUS;
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      return;
    }

    const cx = x + w / 2;
    const cy = y + h / 2;
    const a = w / 2;
    const b = h / 2;
    const n = SQUIRCLE_N;
    const STEPS = 96;
    for (let i = 0; i <= STEPS; i++) {
      const th = (i / STEPS) * Math.PI * 2;
      const c = Math.cos(th);
      const si = Math.sin(th);
      const px = cx + a * Math.sign(c) * Math.abs(c) ** (2 / n);
      const py = cy + b * Math.sign(si) * Math.abs(si) ** (2 / n);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  private drawPiece(p: Piece, ch: string, li: number) {
    const ctx = this.ctx!;
    const fade = (p.a !== undefined && p.a < 1) || !!p.blur;
    if (fade) {
      ctx.save();
      if (p.a !== undefined) ctx.globalAlpha = p.a;
      if (p.blur && p.blur > 0.2) ctx.filter = `blur(${p.blur.toFixed(2)}px)`;
    }
    ctx.fillStyle = this.pal.box;
    this.fillBox(p.x, p.y, p.w, p.h);
    ctx.fillStyle = this.pal.ink;
    const L = this.letters[li];
    ctx.save();
    ctx.translate(p.gx, p.gy);
    ctx.scale(p.gs, p.gs);

    // Canvas filters blur in the current transform space, so a glyph drawn
    // under a 3.46x scale would defocus three and a half times harder than the
    // box drawn right beside it.
    if (fade && p.blur && p.blur > 0.2 && p.gs !== 1) {
      ctx.filter = `blur(${(p.blur / p.gs).toFixed(3)}px)`;
    }

    ctx.fillText(ch, L.drawX - L.gcx, this.baseline - L.gcy);
    ctx.restore();

    const sel = p.sel ?? 1;
    if (sel > 0.002) {
      if (sel < 1) {
        ctx.save();
        ctx.globalAlpha = (p.a ?? 1) * sel;
        this.handles(p.x, p.y, p.w, p.h, p.hr);
        ctx.restore();
      } else {
        this.handles(p.x, p.y, p.w, p.h, p.hr);
      }
    }
    if (fade) ctx.restore();
  }

  private handles(x: number, y: number, w: number, h: number, r: number) {
    const ctx = this.ctx!;
    const corners: [number, number][] = [
      [x, y],
      [x + w, y],
      [x, y + h],
      [x + w, y + h],
    ];
    ctx.fillStyle = this.pal.handle;
    ctx.strokeStyle = this.pal.handle;
    for (const [hx, hy] of corners) {
      switch (this.handleShape) {
        case "square":
          ctx.fillRect(hx - r * 0.86, hy - r * 0.86, r * 1.72, r * 1.72);
          break;
        case "hollow":
          ctx.lineWidth = Math.max(1, r * 0.42);
          ctx.strokeRect(hx - r * 0.8, hy - r * 0.8, r * 1.6, r * 1.6);
          break;
        case "diamond":
          ctx.beginPath();
          ctx.moveTo(hx, hy - r * 1.15);
          ctx.lineTo(hx + r * 1.15, hy);
          ctx.lineTo(hx, hy + r * 1.15);
          ctx.lineTo(hx - r * 1.15, hy);
          ctx.closePath();
          ctx.fill();
          break;
        case "bar": {
          const horiz = w >= h;
          const len = r * 2.6;
          const thick = Math.max(1.5, r * 0.7);
          if (horiz) ctx.fillRect(hx - len / 2, hy - thick / 2, len, thick);
          else ctx.fillRect(hx - thick / 2, hy - len / 2, thick, len);
          break;
        }
        default:
          ctx.beginPath();
          ctx.arc(hx, hy, r, 0, Math.PI * 2);
          ctx.fill();
      }
    }
  }

  private drawWord(scale: number) {
    const ctx = this.ctx!;
    const r = this.wordRect(scale);
    if (scale > 0.002) {
      ctx.fillStyle = this.pal.box;
      this.fillBox(r.x, r.y, r.w, r.h);
      if (scale > 0.02) {
        ctx.fillStyle = this.pal.ink;
        ctx.save();
        ctx.translate(this.W / 2, this.H / 2);
        ctx.scale(scale, scale);
        ctx.translate(-this.wordW / 2, -this.wordH / 2);
        for (const L of this.letters) ctx.fillText(L.ch, L.drawX, this.baseline);
        ctx.restore();
      }
    }
    // The handles do not scale with the word during the pop, which is why the
    // near-zero word reads as a single dot before the box explodes out of it.
    this.handles(r.x, r.y, r.w, r.h, HANDLE_R * this.S);
  }

  private draw(t: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    ctx.fillStyle =
      this.prevPal && t < FIELD_FADE
        ? mixHex(this.prevPal.bg, this.pal.bg, smooth(t / FIELD_FADE))
        : this.pal.bg;
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.font = this.font;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    if (t < T_SPLIT) {
      const emerge = this.prevPal && t < EMERGE_DUR ? popE(clamp01(t / EMERGE_DUR)) : 1;
      this.drawWord(emerge);
      return;
    }

    if (t < T_ZOOM_END) {
      for (let li = 0; li < this.letters.length; li++) {
        const p = this.scatterPiece(li, t);
        if (!p) continue;
        // Everything else defocuses: the selection narrows to the letter the
        // camera is about to dive into.
        const fadeStart = T_SPLIT + SELECT_ALL_HOLD;
        p.sel = li === 0 ? 1 : lerp(1, SELECT_DIM, smooth((t - fadeStart) / SELECT_FADE));
        this.drawPiece(p, this.letters[li].ch, li);
      }
      return;
    }

    const { pop, popEnd, collapse, loop } = this.timeline();

    if (t < pop) {
      const slotCount = this.trainSlots().length;
      for (let ti = 0; ti < slotCount; ti++) {
        const p = this.trainPiece(ti, t);
        if (p) {
          const li = this.trainIndex(ti);
          this.drawPiece(p, this.letters[li].ch, li);
        }
      }
      return;
    }

    if (t < popEnd) {
      this.drawWord(popE(clamp01((t - pop) / (popEnd - pop))));
      return;
    }

    if (!this.popped) {
      this.popped = true;
      this.opts.onPop?.();
    }

    if (t >= collapse && loop > collapse) {
      this.drawWord(1 - popE(clamp01((t - collapse) / (loop - collapse))));
      return;
    }
    this.drawWord(1);
  }
}
