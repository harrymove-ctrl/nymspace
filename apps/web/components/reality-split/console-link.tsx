"use client";

import Link from "next/link";
import type { ComponentProps, MouseEvent } from "react";
import { CONSOLE_PRELOADER_EVENT } from "./console-preloader";

/**
 * A link to the console that hands the navigation to `ConsolePreloader`.
 *
 * Still a `Link`, deliberately. A `<button>` would have been fewer moving
 * parts and would have cost the three things a real link gives away for free:
 * the prefetch that puts the console's payload in the cache before the click,
 * a real `href` for cmd-click, middle-click and "copy link address", and the
 * status bar telling the reader where they are about to go. So the element
 * stays a link and only the plain left click is intercepted — every modifier
 * click falls through to the browser, which is what someone opening the
 * console in a second tab expects, and they get no overlay because they are
 * not leaving this page.
 *
 * The overlay is mounted by the root layout and listens on the window, so the
 * landing page does not have to thread a context down to its header.
 *
 * There is no no-JavaScript failsafe here, and none is needed: without the
 * bundle this renders as the plain server-rendered anchor it already is and
 * the browser navigates normally. The overlay is the thing that never appears,
 * which is the correct way for a transition to fail.
 */
export function ConsoleLink({
  href = "/console",
  onClick,
  ...rest
}: ComponentProps<typeof Link>) {
  const intercept = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    // Anything but an unmodified primary click is the browser's to handle.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    window.dispatchEvent(
      new CustomEvent(CONSOLE_PRELOADER_EVENT, { detail: { href: String(href) } }),
    );
  };

  return <Link href={href} onClick={intercept} {...rest} />;
}
