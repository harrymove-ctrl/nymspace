"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { lockScroll } from "@/lib/scroll-lock";
import { RealitySplit } from "./engine";

/**
 * The transition into `/console`: one pass of the split-and-inspect piece,
 * playing the word CONSOLE, over the top of the navigation it triggered.
 *
 * Three things decide where this component lives and how it ends.
 *
 * **It is mounted by the root layout, not by the page.** The overlay has to
 * outlive the navigation that starts it — rendered from `app/page.tsx` it
 * would unmount the instant the router left `/`, taking the animation with it
 * a few hundred milliseconds in. A layout is not re-rendered when the router
 * moves to one of its children, so mounting it there is what lets the piece
 * play across the route change. The link talks to it through a window event
 * rather than a context, so nothing on the landing page has to become a
 * client component to fire it.
 *
 * **The navigation starts immediately and the animation is not in its way.**
 * `router.push` goes out on the same tick the overlay appears, so the console's
 * data is in flight for the whole pass. The overlay lifts when the word has
 * popped back whole AND the router has arrived — whichever is slower — so a
 * fast connection watches the piece and a slow one does not get dropped onto a
 * spinner halfway through it.
 *
 * **It can never trap the page.** An overlay that fails to lift is worse than
 * no overlay: a hard stop covers a thrown engine, a navigation that never
 * commits, and a canvas context that was never granted.
 */

/**
 * Someone who clicked is already waiting, so the piece plays quicker than the
 * reference — but not as quick as it first shipped.
 *
 * The number that matters is not the total, it is the inspection: seven
 * letters share the 2.2s between the dive landing and the pop, which is ~310ms
 * each at the measured speed. At 1.75 that was 180ms, and a letter that
 * arrives on a damped spring needs long enough to visibly settle or the spring
 * is wasted — the whole passage read as a flick rather than as something being
 * looked at. 1.35 gives each letter ~230ms and the pass ~4.4s.
 */
const SPEED = 1.35;

const FADE_MS = 380;

/**
 * The exit of last resort, derived rather than typed.
 *
 * A full pass to the pop is ~5.9s of choreography, so at `SPEED` it is ~4.4s;
 * this has to outlast that plus the router, and writing it as a flat number
 * meant that slowing the piece down once yanked the overlay mid-inspection —
 * which is exactly what changing `SPEED` would have done had it stayed one.
 */
const HARD_STOP_MS = (5.95 / SPEED) * 1000 + 1400;

/** Reduced motion gets one still frame, held just long enough to register. */
const STILL_MS = 420;

export const CONSOLE_PRELOADER_EVENT = "nymspace:console-preloader";

export function ConsolePreloader() {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  /**
   * The two exits are independent and either can land first, so each records
   * itself and the overlay lifts when both are in. A single "done" flag here
   * was the bug that showed the console's spinner for a beat: the animation
   * finished, the overlay left, and the page had not arrived yet.
   */
  const poppedRef = useRef(false);
  const arrivedRef = useRef(false);
  const doneRef = useRef(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setLeaving(true);
    window.setTimeout(() => {
      setVisible(false);
      setLeaving(false);
      poppedRef.current = false;
      arrivedRef.current = false;
      doneRef.current = false;
    }, FADE_MS);
  }, []);

  const settle = useCallback(() => {
    if (poppedRef.current && arrivedRef.current) finish();
  }, [finish]);

  // The router arriving is the other half of the exit. `usePathname` updates
  // when the navigation commits, which is the moment the console is the page
  // underneath — not necessarily the moment its data is in, but past that the
  // console's own loading state is the honest thing to show.
  useEffect(() => {
    if (!visible) return;
    if (pathname?.startsWith("/console")) {
      arrivedRef.current = true;
      settle();
    }
  }, [pathname, visible, settle]);

  useEffect(() => {
    const open = (e: Event) => {
      const href = (e as CustomEvent<{ href?: string }>).detail?.href ?? "/console";
      setVisible(true);
      router.push(href);
    };
    window.addEventListener(CONSOLE_PRELOADER_EVENT, open);
    return () => window.removeEventListener(CONSOLE_PRELOADER_EVENT, open);
  }, [router]);

  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dark = document.documentElement.classList.contains("dark");

    let engine: RealitySplit | null = null;
    let ro: ResizeObserver | null = null;

    const raf = requestAnimationFrame(() => {
      if (!canvasRef.current || doneRef.current) return;
      engine = new RealitySplit(canvas, {
        word: "CONSOLE",
        palette: dark ? "console" : "consoleLight",
        shape: "rect",
        handleShape: "square",
        speed: SPEED,
        // One pass, one world: the variant cycle exists to make a looping card
        // worth watching twice, and this plays exactly once.
        variants: [],
        onPop: () => {
          poppedRef.current = true;
          engine?.stop();
          settle();
        },
      });
      if (!engine.ok) {
        // No 2D context means no piece. The navigation is already in flight;
        // the overlay must not outlive its own failure.
        poppedRef.current = true;
        settle();
        window.setTimeout(finish, 200);
        return;
      }

      // The canvas is the viewport, and the viewport is not settled at mount.
      // A ResizeObserver rather than a window listener: it fires once on
      // observe, which is what guarantees the bitmap matches the element even
      // when the first measurement was taken before layout — and it covers a
      // mobile address bar collapsing mid-pass, which changes the element's
      // height without a resize event.
      ro = new ResizeObserver(() => engine?.resize());
      ro.observe(canvas);

      if (reduced) {
        engine.renderStill();
        window.setTimeout(() => {
          poppedRef.current = true;
          settle();
        }, STILL_MS);
        return;
      }
      engine.start();
    });

    const hardStop = window.setTimeout(finish, reduced ? STILL_MS + 600 : HARD_STOP_MS);

    // Anyone who touches anything has stopped waiting for the animation.
    const skip = () => finish();
    window.addEventListener("pointerdown", skip, { once: true });
    window.addEventListener("keydown", skip, { once: true });
    window.addEventListener("wheel", skip, { once: true, passive: true });

    // The overlay covers the viewport; a scroll underneath it would land the
    // reader somewhere they did not choose.
    const unlockScroll = lockScroll();

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(hardStop);
      window.removeEventListener("pointerdown", skip);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("wheel", skip);
      unlockScroll();
      ro?.disconnect();
      engine?.destroy();
    };
  }, [visible, finish, settle]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-label="Opening the console"
      data-console-preloader
      className={[
        "console-preloader-shell fixed inset-0 z-[120] bg-[#fdfdfd] dark:bg-[#0e0e0e]",
        "transition-opacity ease-out motion-reduce:transition-none",
        leaving ? "pointer-events-none opacity-0" : "opacity-100",
      ].join(" ")}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      <canvas ref={canvasRef} aria-hidden className="h-full w-full" />
    </div>
  );
}
