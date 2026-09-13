"use client";

/**
 * Four 1-bit textures, one per outcome.
 *
 * Adapted from Amicro's dither charts (MIT, © 2026 Syed Subhan Uddin —
 * https://github.com/Subhan-code/Amicro--Micro-transitions-). The technique is
 * theirs; the colours are not. Their defs hardcode `#FFFFFF` and `#525252` and
 * branch on a `theme` prop, which is two decisions this console has already
 * made in one place — so every ink here is a `var()` and the theme switch
 * recolours the chart with no JavaScript, the same arrangement `outcome-bars`
 * uses for its solid fills.
 *
 * ## Why texture and not only colour
 *
 * The console spends almost no colour — dashed rules, greys, and accent on
 * exactly one control. A stacked bar needs its segments told apart, and the
 * usual answer is four more colours, which would make this the loudest thing
 * on the screen and put it in a register nothing else here speaks.
 *
 * Dithering separates them by density instead. The outcome still carries its
 * own token, so a denied segment and a denied badge stay the same hue as
 * `outcome-bars` established; what differs between segments is how much ink
 * lands per unit area. That reads at a glance, survives a greyscale print, and
 * is legible to a reader who cannot separate the four hues at all — the
 * encoding is redundant rather than decorative.
 *
 * Density is ordered the way the outcomes are: `success` is nearly solid,
 * `pending` is nearly empty. A bar that is mostly ink went mostly well.
 */

import type { Status } from "./outcome-status";

/**
 * One `<defs>` per chart instance, and the ids carry a prefix because of it.
 *
 * Pattern ids are document-global. Two charts on one page — the fleet's and an
 * agent's — would define `dither-success` twice, and every segment in both
 * would resolve to whichever `<defs>` the browser parsed last. That is not a
 * visible break; it is two charts silently sharing one definition, which is
 * the failure that gets found by someone wondering why a colour change only
 * took on one of them.
 */
export function DitherDefs({ idPrefix }: { idPrefix: string }) {
  return (
    /*
      Zero-sized and hidden. The defs have to be in the document to be
      referenced, but they paint nothing themselves.

      `aria-hidden` because a screen reader that walks into this finds four
      patterns and no content. The chart states its own numbers in text
      beside it, which is where the answer lives for a reader who is not
      looking at texture.
    */
    <svg width={0} height={0} aria-hidden focusable="false">
      <defs>
        {/* success — the densest. A checker at 4 units leaves half the area
            inked, which is as close to solid as a dither gets before it stops
            reading as a texture at all. */}
        <pattern
          id={`${idPrefix}-success`}
          width={4}
          height={4}
          patternUnits="userSpaceOnUse"
        >
          <rect x={0} y={0} width={2} height={2} fill="var(--color-success)" />
          <rect x={2} y={2} width={2} height={2} fill="var(--color-success)" />
        </pattern>

        {/* denied — a 45° hatch. Diagonal on purpose: it is the one direction
            neither the bars nor the frame's rules run in, so a denied segment
            cannot be mistaken for a gap between them. */}
        <pattern
          id={`${idPrefix}-denied`}
          width={6}
          height={6}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={6}
            stroke="var(--color-warning)"
            strokeWidth={2}
          />
        </pattern>

        {/* failed — stipple. Sparser than denied because fewer things went
            this wrong, and the eye should be able to rank the two without
            reading the legend. */}
        <pattern
          id={`${idPrefix}-failed`}
          width={5}
          height={5}
          patternUnits="userSpaceOnUse"
        >
          <circle cx={1.5} cy={1.5} r={1.1} fill="var(--color-error)" />
          <circle cx={4} cy={4} r={0.7} fill="var(--color-error)" />
        </pattern>

        {/* pending — the emptiest, and in the secondary ink rather than a
            status colour. Nothing has happened yet, so it should not compete
            with the three outcomes that have. */}
        <pattern
          id={`${idPrefix}-pending`}
          width={6}
          height={6}
          patternUnits="userSpaceOnUse"
        >
          <line
            x1={0}
            y1={3}
            x2={6}
            y2={3}
            stroke="var(--color-text-secondary)"
            strokeWidth={1}
            strokeDasharray="1 2"
          />
        </pattern>
      </defs>
    </svg>
  );
}

/** The `fill` for one outcome's segments, against a matching `DitherDefs`. */
export function ditherFill(idPrefix: string, status: Status) {
  return `url(#${idPrefix}-${status})`;
}

/**
 * The same texture at legend size.
 *
 * A swatch rather than a `StatusDot`: the legend has to show what the segment
 * actually looks like, and a solid dot in the same hue would teach the reader
 * a key the chart does not use.
 */
export function DitherSwatch({
  idPrefix,
  status,
}: {
  idPrefix: string;
  status: Status;
}) {
  return (
    <svg width={12} height={12} aria-hidden focusable="false">
      <rect
        width={12}
        height={12}
        rx={2}
        fill={ditherFill(idPrefix, status)}
        stroke="var(--color-border)"
        strokeWidth={1}
      />
    </svg>
  );
}
