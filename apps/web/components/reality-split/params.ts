/**
 * Constants for the split-and-inspect piece, in two clearly fenced halves.
 *
 * **MEASURED** came off a 162-frame reference clip at 25fps (a 700px square,
 * 6.48s, the word "Reality") read frame by frame. It is data, not knobs. The
 * numbers that look most arbitrary are exactly the ones that must not move:
 * the eases have fatter tails than any closed form, the seam gaps are three
 * different sizes because a human made them, and the drift law was solved from
 * two letters' displacement. Every length is a fraction of the card's short
 * side so the piece scales without re-measuring.
 *
 * **TUNABLE** is everything an instance may override through
 * `RealitySplitOptions`. Change these freely.
 *
 * The fence exists because without it there is no way to tell which numbers
 * are safe to touch.
 */

/* ────────────────────────────────────────────────────────────────────────────
   TUNABLE — defaults an instance can override
   ──────────────────────────────────────────────────────────────────────── */

export const WORD: string = "Animation";

export interface Palette {
  /** The field the whole piece sits on. */
  bg: string;
  /** The selection object under each glyph. */
  box: string;
  /** The four corner handles. */
  handle: string;
  /** The glyph itself. */
  ink: string;
}

/**
 * Four flat colours per world, because a design tool has no gradients.
 *
 * The handle wants to be the loudest of the four and clear of both the field
 * and the box in *value* as well as hue — matched in value and the corners
 * disappear into whichever surface they land on, which is the one part of the
 * composition that has to stay legible at every scale.
 */
export const PALETTES: Record<string, Palette> = {
  /** The reference world: white Helvetica Bold, ultramarine boxes, acid field. */
  volt: { bg: "#ffe500", box: "#1f22c9", handle: "#ff3d00", ink: "#ffffff" },

  /**
   * The reference palette's boxes and handles on this site's own near-black
   * field. A full-viewport acid-yellow flash on a dark page is a punishment,
   * not a transition; the ultramarine/vermilion pairing is what carries the
   * look, and it survives the field swap intact.
   */
  console: { bg: "#0e0e0e", box: "#1f22c9", handle: "#ff3d00", ink: "#ffffff" },

  /** The same world for a light theme — paper instead of near-black. */
  consoleLight: { bg: "#fdfdfd", box: "#1f22c9", handle: "#ff3d00", ink: "#ffffff" },

  reality: { bg: "#4e49fc", box: "#0b5c35", handle: "#e8ff97", ink: "#ffffff" },
  mint: { bg: "#0f3d2e", box: "#7cf0b8", handle: "#ff5c7a", ink: "#0f3d2e" },
  studio: { bg: "#f3f3f5", box: "#1e1e1e", handle: "#0d99ff", ink: "#ffffff" },
  press: { bg: "#d94f2b", box: "#2b1a12", handle: "#f2d8a7", ink: "#fff8ee" },
  terminal: { bg: "#0d0f0c", box: "#14301c", handle: "#5cff8f", ink: "#d8ffe4" },
  klein: { bg: "#f4f4f6", box: "#002fa7", handle: "#ff5c00", ink: "#ffffff" },
  paper: { bg: "#e8e8e6", box: "#111111", handle: "#8a8a8a", ink: "#ffffff" },
};

export const PALETTE: Palette = PALETTES.volt;

/** 0 keeps the reference square's proportions; 1 stretches to full card width. */
export const SCATTER_SPREAD = 0.5;

/** What *kind* of object is selected. */
export type BoxShape = "rect" | "round" | "ellipse" | "squircle";

export type HandleShape = "circle" | "square" | "hollow" | "diamond" | "bar";

export const BOX_RADIUS = 0.22;

export const SQUIRCLE_N = 4;

/**
 * How much a shape must grow to still contain the ink it was fitted to.
 *
 * This is geometry, not taste. A box fitted to a letter's ink is a rectangle;
 * inscribe an ellipse in that same rectangle and the corners are cut off, so
 * the glyph pokes out of its own selection object — the one thing a
 * design-tool fantasy cannot do. A point at the ink corner satisfies
 * (x/a)^n + (y/b)^n = 1 only once the shape is scaled by 2^(1/n): sqrt(2) for
 * an ellipse, 2^0.25 for a squircle. A rounded rect only clips a corner radius
 * the ink never reaches, so it needs nothing.
 *
 * Applied at *measure* time rather than draw time, so the scatter's overlap
 * relaxation and the train's centring both see the true occupied size.
 */
export const SHAPE_INFLATE: Record<BoxShape, number> = {
  rect: 1,
  round: 1,
  ellipse: Math.SQRT2,
  squircle: Math.pow(2, 1 / SQUIRCLE_N),
};

export interface Variant {
  word?: string;
  palette?: keyof typeof PALETTES | Palette;
  shape?: BoxShape;
  handle?: HandleShape;
  /** Varies the constellation without changing the word. */
  seed?: number;
}

/**
 * The worlds the loop cycles through, one per pass.
 *
 * Each entry changes the word AND the palette AND the shape together: change
 * only one of the three and the pass reads as a recolour of the same
 * animation rather than as a new one.
 */
export const VARIANTS: Variant[] = [
  { word: "Animation", palette: "volt", shape: "rect", handle: "square" },
  { word: "Reality", palette: "mint", shape: "round", handle: "circle", seed: 1 },
  { word: "Selected", palette: "klein", shape: "squircle", handle: "bar", seed: 2 },
  { word: "Objects", palette: "terminal", shape: "ellipse", handle: "diamond", seed: 3 },
  { word: "Layers", palette: "press", shape: "round", handle: "hollow", seed: 4 },
  { word: "Canvas", palette: "studio", shape: "rect", handle: "square", seed: 5 },
];

/** The word shrinks to a dot at the wrap, and the next word grows out of it. */
export const COLLAPSE_DUR = 0.42;
export const EMERGE_DUR = 0.5;
export const FIELD_FADE = 0.55;

export const CYCLE_VARIANTS = true;

/** Inspect every letter, or only the reference's four. */
export const TRAIN_ALL = true;

/**
 * How much of the card's width the assembled word may occupy.
 *
 * The reference's unit is the card's short side, which is the height for every
 * aspect the clip and the card use — so nothing in it ever needed a width
 * check. A full-viewport overlay in portrait is the case that does: a
 * seven-letter word at 178/700 of an 844px height is 880px of glyph in a 390px
 * phone. Below this fraction the engine re-lays the word out at a smaller
 * unit, which is a no-op at the reference proportions.
 */
export const WORD_FIT = 0.86;

/* ────────────────────────────────────────────────────────────────────────────
   MEASURED — read off the reference clip. Data, not knobs.
   ──────────────────────────────────────────────────────────────────────── */

export const FONT_SIZE = 178 / 700;
export const WORD_H = 208 / 700;
export const PAD_X = 22 / 700;

export const BASELINE_FRAC = 158 / 208;

export const HANDLE_R = 11.75 / 700;
export const HANDLE_R_GIANT = 30 / 700;

/**
 * The reference's own hand-measured letter boxes, kept for provenance.
 *
 * Not used to lay anything out any more, and that is the point: keying a box
 * by character meant one shared fallback for every letter the clip did not
 * contain, and that fallback was NARROWER THAN A CAPITAL A OR M, so those
 * letters hung outside their own selection boxes. Boxes now come from each
 * glyph's real ink bounds plus `FIT_PAD_X` / `FIT_PAD_Y`, which were recovered
 * by solving these numbers back against the R.
 */
export const TIGHT: Record<string, [number, number]> = {
  R: [150 / 700, 174 / 700],
  e: [106 / 700, 126 / 700],
  a: [102 / 700, 126 / 700],
  l: [71 / 700, 161 / 700],
  i: [71 / 700, 161 / 700],
  t: [78 / 700, 150 / 700],
  y: [115 / 700, 154 / 700],
};

export const REFERENCE_WORD: string = "Reality";

/** Padding around the ink, read off the R. */
export const FIT_PAD_X = 0.16;
export const FIT_PAD_Y = 0.26;

/**
 * The golden angle — 137.5°, so no two letters are ever in line and the
 * constellation never resolves into a visible ring.
 */
export const SCATTER_ANGLE = Math.PI * (3 - Math.sqrt(5));

export const SCATTER_INNER = 0.26;
export const SCATTER_OUTER = 0.46;

export const SCATTER_RELAX_PASSES = 60;
export const SCATTER_GAP = 0.03;

/**
 * The reference's hand-composed constellation, kept for provenance.
 *
 * Keying it by character is the bug that hid four others: 'a' sat at dead
 * centre and the camera dives into dead centre, so the letter magnified was
 * whichever one happened to be NAMED a. The same keying stacked both i's of a
 * word on one identical point and dropped every unnamed letter onto a fallback
 * ring. The constellation is generated by index now — see `scatterLayout`.
 */
export const SCATTER: Record<string, [number, number]> = {
  R: [20 / 700, 166 / 700],
  e: [177 / 700, 572 / 700],
  a: [350 / 700, 350 / 700],
  l: [572 / 700, 114 / 700],
  i: [672 / 700, 224 / 700],
  t: [474 / 700, 540 / 700],
  y: [626 / 700, 644 / 700],
};

/** Three different sizes, because a human made them. Cycled for longer words. */
export const SEAM_GAPS = [33 / 700, 33 / 700, 29 / 700, 43 / 700, 29 / 700, 29 / 700];

/**
 * The drift law, solved from two letters: R at 354px out moved 88px, e at
 * 280px moved 57px. Both give d²/1430 — quadratic in distance, and the engine
 * squares the time too, which reads as a slow explosion still breathing.
 */
export const DRIFT_D0 = 1430 / 700;

export const ZOOM = 3.46;

/** How much of the card the inspected letter is allowed to fill. */
export const TRAIN_FIT = 0.86;

/** How far toward equal optical size the letters are pulled: 0 off, 1 full. */
export const TRAIN_NORMALISE = 0.8;

export const ZOOM_FADE_IN = 0.05;
export const ZOOM_FADE_OUT = 0.34;

export const ZOOM_BLUR = 15 / 700;

/** The reference's four inspected letters and their absolute timings. */
export const TRAIN = ["a", "R", "e", "t"] as const;
export const ARRIVE = [3.44, 4.12, 4.72];
export const ARRIVE_DUR = [0.28, 0.18, 0.18];
export const DEPART = [3.48, 4.08, 4.68, 5.24];

export const DEPART_DUR = 0.14;

export const TRAIN_ARRIVE_SLOW = 0.2;
export const TRAIN_ARRIVE_FAST = 0.11;

/**
 * A floor, not a remainder.
 *
 * The first generated schedule divided the window into equal steps and let the
 * hold be whatever survived the slides, which on nine letters went NEGATIVE:
 * every letter began departing before it had finished arriving, nothing was
 * ever motionless, and the passage read as a blur of two or three glyphs. The
 * schedule is built forward from a guaranteed still hold instead, and the loop
 * stretches to fit the word rather than the train racing to fit the loop.
 */
export const TRAIN_DWELL_MIN = 0.09;

/** A move that merely decelerates reads as a cut; a spring reads as mass. */
export const SPRING_FREQ = 8.5;
export const SPRING_DAMP = 5;
export const SPRING_AMP = 0.02;

export const TRAIN_OVERLAP = 0.35;

export const LOOP = 6.48;
export const T_SPLIT = 0.36;
export const T_SPREAD_END = 0.6;
export const T_SCATTER = 0.64;
export const T_SCATTER_END = 1.36;
export const T_ZOOM = 1.92;
export const T_ZOOM_END = 3.36;
export const T_POP = 5.52;
export const T_POP_END = 5.88;

export const SELECT_ALL_HOLD = 0.55;
export const SELECT_FADE = 0.45;
export const SELECT_DIM = 0.22;

export const TIGHTEN_IN = 0.11;
export const TIGHTEN_OUT = 0.55;

/**
 * One motion language everywhere: lazy wind-up, violent middle, long soft
 * landing, zero rotation.
 *
 * No closed form fits it — the measured curves have fatter tails than any
 * cubic-bezier or sigmoid. The zoom covers 26%→80% of its travel in five
 * frames around k=0.4 and then spends a fifth of the phase on the last 5%; the
 * reassembly pop goes 4.5%, 16%, then EIGHTY-ONE percent between two frames.
 * So each phase ships its control points and the engine runs them through a
 * monotone cubic spline — monotone matters, a Catmull-Rom rings on either side
 * of the violent segment.
 */
export const SCATTER_E: [number, number][] = [
  [0, 0], [0.2, 0.02], [0.33, 0.05], [0.45, 0.35],
  [0.56, 0.8], [0.67, 0.94], [0.78, 0.99], [1, 1],
];

export const ZOOM_E: [number, number][] = [
  [0, 0], [0.06, 0.02], [0.17, 0.06], [0.28, 0.15], [0.33, 0.26],
  [0.39, 0.66], [0.44, 0.8], [0.5, 0.86], [0.56, 0.9],
  [0.67, 0.955], [0.78, 0.98], [0.89, 0.995], [1, 1],
];

export const TRAV_E: [number, number][] = [
  [0, 0], [0.2, 0.03], [0.35, 0.15], [0.5, 0.5],
  [0.65, 0.88], [0.8, 0.975], [1, 1],
];

export const POP_E: [number, number][] = [
  [0, 0], [0.11, 0.01], [0.22, 0.045], [0.33, 0.16], [0.44, 0.81],
  [0.56, 0.92], [0.67, 0.964], [0.78, 0.986], [0.89, 0.997], [1, 1],
];
