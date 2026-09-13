"use client";

import { VStack } from "@astryxdesign/core/VStack";
import { cn } from "cn";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  createBend,
  supportsHtmlInCanvas,
  type BendInstance,
  type BendOptions,
} from "@/lib/bend/bend-vanilla";

/**
 * A region that scrolls on the face of a cube.
 *
 * The top and bottom of the region fold over a virtual edge as it scrolls, and
 * flatten back out at each scroll end. The effect is `canvas-ui`'s Bend; the
 * shader and the whole of its behaviour are in `lib/bend/bend-vanilla.ts`,
 * cloned from upstream. This file is the React half — the three elements the
 * effect needs, and the one decision upstream leaves to its caller: how tall
 * the region is.
 *
 * ## Height is the whole integration
 *
 * A fold is a reaction to scrolling, so a region that fits its content never
 * folds. Upstream's demo is the page, which is taller than the viewport by
 * construction; a console frame is as tall as whatever is inside it. So the
 * region is capped, and the cap is what makes the effect exist at all.
 *
 * It is a `max-height`, not a `height`. A frame shorter than the cap keeps its
 * own height, does not scroll, never folds and — see `bend-vanilla.ts` — is
 * never covered by the canvas either. Short frames are the untouched DOM, and
 * the console only changes where there was something to scroll.
 *
 * The exception is the html-in-canvas path, where the content lives inside an
 * absolutely positioned `<canvas>` and so contributes no height to measure a
 * cap against. That path gets a definite height instead.
 *
 * ## Why a custom property and not a style prop
 *
 * `AGENTS.md` forbids `style={{…}}` in console components, and it is right to:
 * a literal value in a style object is a value that resolves to no token. The
 * cap is neither literal nor static — it is a caller's number — so it arrives
 * as `--bend-height` set on the node, and `globals.css` is the only place that
 * decides what the property *means*. Setting one custom property through a ref
 * is the same arrangement `scroll-shell` uses for `--scroll-edge-surface`.
 */

export interface BendScrollProps extends BendOptions {
  children: ReactNode;
  /**
   * The tallest the region gets, in CSS pixels, before it scrolls and folds.
   * Content shorter than this is left exactly as it is.
   */
  height?: number;
  className?: string;
}

/**
 * The cap every console frame gets unless it asks for another.
 *
 * Measured against the frames that exist rather than chosen for how it reads:
 * the agent inspector's eleven frames run 88, 192, 192, 270, 271, 313, 313,
 * 406, 412, 424 and 560 pixels tall. A cap above about 430 folds one of them.
 * At 340 the four substantial ones fold and the small ones are left alone,
 * which is the split the effect is for — a frame with nothing to scroll has
 * nothing to fold, and capping it would only hide content to no end.
 *
 * Lower this and more frames fold at the cost of a shorter reading window.
 * `<Frame bend={240}>` does it for one frame; this constant does it for all.
 */
const DEFAULT_HEIGHT = 340;

/** Nothing to subscribe to: the answer is fixed for the life of the document. */
const noSubscribe = () => () => {};

/**
 * The fold, in proportion to the region it folds.
 *
 * Upstream's defaults are absolute pixel counts — a 240px fold zone, a 150px
 * crease radius, 240px of scroll to flatten over — and they are right for what
 * upstream bends, which is the whole page. A console frame is a few hundred
 * pixels tall, and on one of those the same numbers stop being a fold: the zone
 * clamps to just under half the height at each edge, which leaves single digits
 * of flat surface in the middle and curves the entire box.
 *
 * So the ratios are what carry over, not the numbers. At upstream's own
 * viewport its zone is about three tenths of the height and its crease a little
 * under two thirds of the zone, and holding those makes a 340px frame fold the
 * way its demo folds rather than the way a 340px slice of its demo would.
 *
 * `ease` is the scroll distance an edge flattens over, so it is measured
 * against how far there is to scroll rather than how tall the region is. Half
 * the height is the closest stand-in available here — a frame that overflows by
 * less than upstream's flat 240px would otherwise never reach a full fold at
 * all, which is the case for most frames in the console.
 *
 * Every one of these is still a `BendOption`. A caller that passes its own wins.
 */
function proportions(height: number): BendOptions {
  const zone = Math.round(height * 0.3);
  return { zone, rounding: Math.round(zone * 0.62), ease: Math.round(height * 0.5) };
}

export function BendScroll({
  children,
  height = DEFAULT_HEIGHT,
  className,
  ...options
}: BendScrollProps) {
  const sourceRef = useRef<HTMLCanvasElement>(null);
  const outputRef = useRef<HTMLCanvasElement>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const instanceRef = useRef<BendInstance | null>(null);
  const [initialOptions] = useState<BendOptions>({
    ...proportions(height),
    ...options,
  });
  const [failed, setFailed] = useState(false);

  /*
    `useSyncExternalStore` with a server snapshot of `false` rather than an
    effect: the server cannot know, and rendering the supported tree first
    would be a hydration mismatch on every machine without the flag.
  */
  const supported = useSyncExternalStore(
    noSubscribe,
    supportsHtmlInCanvas,
    () => false,
  );
  const native = supported && !failed;

  const hostRef = useCallback(
    (node: HTMLElement | null) => {
      node?.style.setProperty("--bend-height", `${height}px`);
    },
    [height],
  );

  useEffect(() => {
    const source = sourceRef.current;
    const content = contentRef.current;
    const output = outputRef.current;
    if (!source || !content || !output) return;
    instanceRef.current = createBend(
      { source, content, output },
      initialOptions,
    );
    // No WebGL2 and no effect. The DOM below is already the fallback, so there
    // is nothing to do but stop asking for the canvas path.
    if (native && !instanceRef.current) setFailed(true);
    return () => {
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, [initialOptions, native]);

  // Options are read live by the instance, so every render forwards them.
  useEffect(() => {
    instanceRef.current?.setOptions({ ...proportions(height), ...options });
  });

  const scroller = (
    <VStack
      ref={contentRef}
      gap={0}
      width="100%"
      className={native ? "bend-scroll-full scroll-quiet" : "bend-scroll scroll-quiet"}
    >
      {children}
    </VStack>
  );

  return (
    <VStack
      ref={hostRef}
      gap={0}
      width="100%"
      className={cn(
        "bend-host min-w-0",
        native && "bend-host-fixed",
        className,
      )}
    >
      {/*
        A `<canvas>` is a surface, the way an `<img>` is an image — the same
        reading `decrypt-gate.tsx` records. Astryx wraps neither, and neither
        stands in for layout here: the layout is the `VStack`s.
      */}
      <canvas
        ref={sourceRef}
        // @ts-expect-error html-in-canvas is experimental and has no typing
        layoutsubtree="true"
        suppressHydrationWarning
        aria-hidden={native ? undefined : true}
        className={native ? "absolute inset-0 size-full" : "hidden"}
      >
        {native ? scroller : null}
      </canvas>
      {native ? null : scroller}
      <canvas
        ref={outputRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 size-full"
      />
    </VStack>
  );
}

export type { BendInstance, BendOptions };
