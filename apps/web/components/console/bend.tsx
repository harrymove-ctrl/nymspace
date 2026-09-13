"use client";

import { VStack } from "@astryxdesign/core/VStack";
import { cn } from "cn";
import { usePathname } from "next/navigation";
import {
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
 * The page, on the face of a cube.
 *
 * The whole screen is one surface. It scrolls inside this region, and the top
 * and bottom of it fold away over a virtual edge as it does, flattening back
 * out at each scroll end. It is not a per-section effect: one face, one fold,
 * whatever is on the page at the time.
 *
 * The effect is `canvas-ui`'s Bend and lives in `lib/bend/bend-vanilla.ts`,
 * cloned from upstream. Upstream's own defaults apply unchanged here, because
 * upstream bends a page and so does this — the numbers were tuned against a
 * viewport, which is exactly what this region is.
 *
 * ## The page scrolls here, not in the document
 *
 * A fold needs a scroll container it owns, so this region is the console's
 * scroller and the document no longer scrolls at all. That costs one thing
 * `globals.css` was careful about: a full-viewport scroller only receives arrow
 * and space keys while focus is inside it, and with focus on the body the
 * browser would scroll a document that now has nowhere to go. `PAGE_KEYS` below
 * is what pays that back — the keys reach the region wherever focus is, unless
 * focus is somewhere those keys already mean something else.
 *
 * The other cost is the top of a screen. The browser restores scroll on the
 * document, and the document no longer moves, so a navigation would leave the
 * next screen at whatever offset the last one happened to be read to. The
 * effect below returns the region to the top on every route change, which is
 * what the browser was doing before this component existed.
 */

export interface BendPageProps extends BendOptions {
  children: ReactNode;
  className?: string;
}

/** Nothing to subscribe to: the answer is fixed for the life of the document. */
const noSubscribe = () => () => {};

/**
 * Keys that scroll a page, and how far.
 *
 * `false` means a viewport, negated for the backwards key. `Home` and `End` are
 * handled by their own branch, since "everything" is not a distance.
 */
const PAGE_KEYS: Record<string, number | false> = {
  ArrowDown: 64,
  ArrowUp: -64,
  PageDown: false,
  PageUp: false,
  " ": false,
};

export function BendPage({ children, className, ...options }: BendPageProps) {
  const sourceRef = useRef<HTMLCanvasElement>(null);
  const outputRef = useRef<HTMLCanvasElement>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const instanceRef = useRef<BendInstance | null>(null);
  const [initialOptions] = useState(options);
  const [failed, setFailed] = useState(false);
  const pathname = usePathname();

  /*
    `useSyncExternalStore` with a server snapshot of `false` rather than an
    effect: the server cannot know whether html-in-canvas is available, and
    rendering the supported tree first would be a hydration mismatch on every
    machine without the flag — which is every machine.
  */
  const supported = useSyncExternalStore(
    noSubscribe,
    supportsHtmlInCanvas,
    () => false,
  );
  const native = supported && !failed;

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
    instanceRef.current?.setOptions(options);
  });

  /*
    A new screen starts at its top.

    Instant rather than smooth, because this is not a scroll the reader asked
    for — animating it would fold the outgoing screen away on a navigation that
    was never a scroll at all.
  */
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname]);

  /*
    The page keys, forwarded to the region that is now the page.

    Skipped whenever focus is on something the same key already drives — a
    field, a select, a scroller of its own — because taking space away from a
    button or arrows away from a listbox to scroll the page behind it is worse
    than the problem this solves.
  */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const content = contentRef.current;
      if (!content || event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        active !== document.body &&
        (active.isContentEditable ||
          active.matches("input, textarea, select, button, [role='listbox']") ||
          (content.contains(active) && active.scrollHeight > active.clientHeight))
      ) {
        return;
      }

      if (event.key === "Home" || event.key === "End") {
        content.scrollTo({
          top: event.key === "Home" ? 0 : content.scrollHeight,
          behavior: "smooth",
        });
        event.preventDefault();
        return;
      }

      const step = PAGE_KEYS[event.key];
      if (step === undefined) return;
      const viewport = content.clientHeight * 0.9;
      content.scrollBy({
        top: step === false ? (event.key === "PageUp" ? -viewport : viewport) : step,
        behavior: "smooth",
      });
      event.preventDefault();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const scroller = (
    <VStack ref={contentRef} gap={0} width="100%" className="bend-scroll scroll-quiet">
      {children}
    </VStack>
  );

  return (
    <VStack gap={0} width="100%" className={cn("bend-page", className)}>
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
