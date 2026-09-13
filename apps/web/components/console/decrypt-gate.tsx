"use client";

import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { usePathname } from "next/navigation";
import * as React from "react";
import { screenSubject } from "@/components/console/nav";
import { useVisitor } from "@/components/console/visitor";
import { createCipherField, type CipherFieldInstance } from "@/lib/cipher-field";
import { createDecryptReveal, type DecryptRevealInstance } from "@/lib/decrypt-reveal";
import { createDomRaster } from "@/lib/dom-raster";

/**
 * A screen you can look at and cannot use until you connect.
 *
 * The console's reads are public and stay public — nothing behind this gate is
 * a secret, and `docs/01`'s whole claim is that a visitor can check the
 * authority boundary against an address they control. What the gate withholds
 * is *acting*: sending a question, running a plan, spending anything. So the
 * content is enciphered rather than removed, decodes under the cursor, and is
 * `inert` the entire time. You can read the screen by moving the mouse across
 * it; you cannot put a cursor in the composer.
 *
 * That is deliberate, and it is the reason the veil is allowed to be an effect
 * rather than a security boundary. If the canvas fails to initialise, if
 * JavaScript never runs, if a reader disables the stylesheet — the screen is
 * legible, which was already true, and still cannot be operated, because
 * `inert` is an attribute the server rendered and not something the effect
 * switches on.
 *
 * ## Which engine runs
 *
 * {@link createDecryptReveal} is DecryptReveal itself, and it is what runs.
 * Every cell of the screen is matched to the ASCII glyph whose shape fits the
 * UI underneath it, in that UI's own colours; the circle at the cursor reveals
 * the real thing behind a wavefront that flickers and fringes.
 *
 * Upstream feeds that shader through html-in-canvas, which is Chromium behind
 * a flag, and a first pass here took that to mean the effect was Chromium's.
 * It is not. The experimental call supplies a *texture* and nothing else — the
 * matching, the reveal, the wavefront are all WebGL2. `lib/dom-raster.ts`
 * supplies the same texture by repainting the subtree with Canvas2D, so the
 * effect runs in every browser with WebGL2, which is every browser.
 *
 * {@link createCipherField} is below that: Canvas2D glyphs over a blurred
 * sheet, for a context that cannot give us WebGL2 at all — a blocklisted
 * driver, a tab that has exhausted its contexts. It never sees the UI, so its
 * cipher is noise rather than a silhouette and the blur is what conceals. It
 * is a floor, not a peer.
 *
 * ## When there is no gate to pass
 *
 * `privyAppId` is optional (`env.public.ts`), so a clone with no credentials
 * has no connect flow at all. Veiling a console behind a button that cannot
 * work is worse than not veiling it, so an unconfigured deployment renders its
 * children plainly. The same applies while Privy is still resolving a restored
 * session: the veil waits rather than flashing over a visitor who turns out to
 * have been connected the whole time.
 */

/**
 * The cipher's geometry, tuned against the console's own density and shared by
 * both engines.
 *
 * Split from the per-engine options below rather than merged into one object
 * because the two option types only overlap here: spreading a bag that carries
 * `opacity` into `DecryptRevealOptions` compiles today and stops compiling the
 * day either library grows a field of that name.
 */
const GEOMETRY = {
  radius: 190,
  softness: 0.55,
  cell: 13,
  aspect: 0.6,
  edgeWidth: 0.24,
  scramble: 0.05,
  scrambleSpeed: 9,
  smoothing: 0.12,
} as const;

export function DecryptGate({
  children,
  /**
   * What the visitor is being asked to unlock, as a noun phrase completing
   * "Connect a wallet to use ___". Defaults to the current screen's own name,
   * which is what the console layout wants: one gate for every route, each
   * naming the screen it is standing in front of.
   */
  subject,
  /**
   * The veiled surface's floor height. The canvas is positioned, so on the
   * first frame the container has only what its content gives it; a screen
   * that has not measured yet would snap the veil open a pixel high.
   */
  minHeight = "20rem",
}: {
  children: React.ReactNode;
  subject?: string;
  minHeight?: string;
}) {
  const visitor = useVisitor();
  const pathname = usePathname();
  const locked = visitor.configured && visitor.ready && !visitor.address;

  /*
    Unconfigured, still resolving, or connected: nothing to veil, and no
    wrapper either. The gate adds a positioned container, a canvas and an
    overlay, and leaving that scaffolding in place for a connected visitor
    would mean every
    console screen is laid out differently depending on a session — a
    difference that shows up as a one-off bug months later.
  */
  if (!locked) return <>{children}</>;

  return (
    /*
      Keyed by route, so a navigation builds a new engine over the new screen
      rather than reusing one holding a raster of the screen you left. The
      engine only redraws its texture when something tells it the texture is
      stale, and a route change is not a resize — Fleet and Activity are close
      enough in height that on some viewports nothing fires at all, and the
      cipher would go on tracing a table that is no longer there.
    */
    <Veil
      key={pathname}
      subject={subject ?? screenSubject(pathname)}
      minHeight={minHeight}
      onConnect={visitor.connect}
    >
      {children}
    </Veil>
  );
}

function Veil({
  children,
  subject,
  minHeight,
  onConnect,
}: {
  children: React.ReactNode;
  subject: string;
  minHeight: string;
  onConnect: () => void;
}) {
  const hostRef = React.useRef<HTMLElement>(null);
  const contentRef = React.useRef<HTMLElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  /** Which engine actually started, for the `data-engine` attribute. */
  const [engine, setEngine] = React.useState<string>();

  /*
    The theme, as a number that changes when it changes.

    Both engines are handed resolved colours — a canvas cannot be given a
    `var()` — so they are holding values from whenever they started. Flipping
    the console to dark would otherwise leave a cipher and, on the raster path,
    a whole repainted UI still wearing the light palette. Rebuilding on the
    class change is the honest fix and costs nothing: it happens when a person
    presses the toggle, not on a frame.
  */
  const [theme, setTheme] = React.useState(0);

  React.useEffect(() => {
    const observer = new MutationObserver(() => setTheme((n) => n + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    const host = hostRef.current;
    const content = contentRef.current;
    const canvas = canvasRef.current;
    if (!host || !content || !canvas) return;

    /*
      The cipher's colours are read off the host rather than written here.
      `AGENTS.md` forbids a literal colour in this codebase and a canvas cannot
      be handed a `var()`, so the one place the two rules meet is a computed
      style: the token stays the single definition, and what reaches the canvas
      is whatever the theme currently resolves it to.
    */
    const styles = getComputedStyle(host);
    const color = styles.getPropertyValue("--color-text-accent").trim();
    const background =
      styles.getPropertyValue("--color-background-body").trim() || "#ffffff";

    /*
      The real engine first, with our own texture supplier.

      Upstream reaches for html-in-canvas here and gets nothing outside
      Chromium. `createDomRaster` repaints the subtree with Canvas2D instead,
      so the shader gets its picture of the UI in every browser and the effect
      that runs is DecryptReveal itself — glyphs matched to the shapes actually
      underneath them, in the colours actually underneath them. See the header
      of `lib/decrypt-reveal.ts`.
    */
    const raster = createDomRaster(content, background);
    let instance: DecryptRevealInstance | CipherFieldInstance | null = null;

    if (raster) {
      instance = createDecryptReveal(
        {
          // Unused on this path: `capture` supplies the texture, so the canvas
          // upstream would have painted into never enters the document.
          source: document.createElement("canvas"),
          content,
          output: canvas,
          capture: (dpr) => (raster.paint(dpr) ? raster.canvas : null),
        },
        {
          ...GEOMETRY,
          color: color || undefined,
          background,
          colored: 1,
          // Nothing of the UI shows through the cipher away from the cursor.
          // Upstream's default leaks fifteen percent, which on a form is
          // enough to find the input by its outline.
          passthrough: 0,
          aberration: 8,
          edgeGlow: 2,
          edgeFlicker: 1,
        },
      );
    }

    /*
      `createDecryptReveal` answers null when WebGL2 is missing or the context
      is lost — a very old browser, a blocklisted driver, a tab that has run out
      of contexts. The glyph field is Canvas2D and asks for none of that, so the
      screen is still veiled and still decodes under the cursor; what it loses
      is the shape matching, because it never sees the UI.
    */
    if (instance) {
      setEngine("decrypt-reveal");
    } else {
      instance = createCipherField(
        { surface: canvas, host },
        { ...GEOMETRY, opacity: 0.7, color: color || undefined },
      );
      setEngine(instance ? "cipher-field" : "none");
    }

    return () => instance?.destroy();
  }, [theme]);

  /*
    One tree, whichever engine runs.

    The html-in-canvas variant upstream ships is gone from here on purpose: it
    needed the console laid out *inside* a canvas, which meant a different DOM
    on the server than on flagged Chromium, a `@ts-expect-error` for an
    attribute React has no typing for, and a ResizeObserver copying the
    subtree's height back onto a host that had nothing else to take it from.
    All of that bought a texture, and `lib/dom-raster.ts` supplies the same
    texture from content that is simply in normal flow.

    `astryx-stack` elements throughout — `AGENTS.md` gives the raw-layout
    exception to `Frame` alone and this is not it. The canvas is not a claim on
    it either: a canvas is the effect's surface, the way an `<img>` is an
    image, and Astryx ships no component that wraps one.
  */
  return (
    <VStack
      ref={hostRef}
      width="100%"
      minHeight={minHeight}
      className="cipher-host relative min-w-0"
      data-engine={engine}
    >
      <Content ref={contentRef}>{children}</Content>

      {/*
        The blur, for the one path that needs it.

        `decrypt-reveal` paints an opaque cipher over the whole surface — its
        texture has the page's own background under the UI — so a sheet in
        front of the content would be frosting something already hidden. The
        glyph field draws ink and nothing between it, and the console would
        read straight through the gaps; that is what this covers. The mask is
        the same circle the field opens, published by the field itself, so the
        two holes cannot drift.
      */}
      {engine === "cipher-field" ? (
        <VStack aria-hidden className="cipher-blur" />
      ) : null}

      <canvas ref={canvasRef} aria-hidden className="cipher-glyphs" />

      <Prompt subject={subject} onConnect={onConnect} />
    </VStack>
  );
}

/**
 * The veiled content.
 *
 * `inert` is the whole gate. Everything else on this screen is an effect that
 * can fail; this is an attribute, it is in the server's markup, and it takes
 * the subtree out of the tab order, out of the accessibility tree and out of
 * hit testing at once. A `pointer-events: none` would have left the composer
 * reachable by keyboard, which is the version of this bug that ships.
 *
 * `cipher-content` is what keeps it *underneath* the cipher. Without the
 * stacking context it establishes, any positioned descendant with a z-index
 * above the canvas paints over the veil — which is not hypothetical: `Frame`
 * puts its title and corner marks at ten, and every frame on every console
 * screen was showing its label in the clear. See `globals.css`.
 */
function Content({
  ref,
  children,
}: {
  ref: React.Ref<HTMLElement>;
  children: React.ReactNode;
}) {
  return (
    <VStack
      ref={ref}
      inert
      width="100%"
      className="cipher-content min-w-0 max-w-full"
    >
      {children}
    </VStack>
  );
}

/**
 * The way in.
 *
 * Outside the captured content on purpose — it is the one thing on the screen
 * that must stay legible with the cursor nowhere near it, so it sits above the
 * cipher rather than inside it.
 *
 * `align="center"` rather than filling: the prompt is a card floating on the
 * veil, and a full-width bar across a ciphered console reads as a failure
 * banner rather than as an invitation.
 *
 * It is sticky rather than centred in the veil. Centring is right for a screen
 * that fits, and the console has two that do not — the new agent form and an
 * agent's detail page run to several times the viewport, and the midpoint of
 * those is a long way below the fold. A visitor would have arrived at a wall of
 * cipher with the way through it somewhere off screen. Sticky puts the card a
 * third of the way down whatever you are looking at, and it stays inside the
 * veil because a sticky element is still bounded by its own parent.
 */
function Prompt({
  subject,
  onConnect,
}: {
  subject: string;
  onConnect: () => void;
}) {
  return (
    <VStack
      justify="start"
      align="center"
      className="pointer-events-none absolute inset-0 z-10 p-6"
    >
      <VStack
        gap={4}
        align="center"
        paddingInline={6}
        paddingBlock={5}
        maxWidth="26rem"
        className="cipher-prompt frame-edge surface-card pointer-events-auto text-center"
      >
        <Text type="label" color="accent">
          [ locked ]
        </Text>

        <Text type="supporting" as="p">
          Connect a wallet to use {subject}. The screen underneath decodes where
          you point it — reading is free, and nothing here is a secret. What a
          connection buys is the ability to act: the reads are performed against
          the address you bring.
        </Text>

        <Button
          size="sm"
          variant="primary"
          label="Connect"
          onClick={onConnect}
        />
      </VStack>
    </VStack>
  );
}
