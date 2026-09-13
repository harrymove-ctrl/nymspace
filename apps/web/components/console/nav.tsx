"use client";

import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The console's six links, and which one you are standing on.
 *
 * A client component for one reason: `usePathname`. The shell around it stays
 * a server component, so the cost of knowing the current route is this file
 * and not the whole header.
 *
 * ## Matching, and why `/console` is not `startsWith`
 *
 * Every href is a prefix of nothing except its own section — apart from
 * `/console`, which is a prefix of all five others. Matching it the same way
 * would light Fleet up on every page in the console, which is an indicator
 * that indicates nothing. So the index matches exactly and the sections match
 * by prefix, the prefix being what keeps Fleet's sibling lit on a detail route
 * like `/console/activity/0x…` that has no nav entry of its own.
 *
 * The boundary check matters as much as the prefix: without it `/console/new`
 * would claim a hypothetical `/console/newsfeed`. Cheap to add now, invisible
 * to debug later.
 *
 * ## Two channels, because the underline is not readable
 *
 * `aria-current="page"` is what a screen reader announces; `data-active` is
 * what `nav-link` paints. They are set from the same value and must stay that
 * way — a highlight with no `aria-current` is an indicator only some readers
 * get. See the `nav-link` utility in `app/globals.css` for the mark itself.
 */

/**
 * The six links, and what each screen is called in a sentence.
 *
 * `subject` is not the label lowercased. It completes "Connect a wallet to use
 * ___" for the connect gate, and a label is a tab on a strip where a subject is
 * a noun in a clause — "use New agent" is a label pretending to be English.
 * Keeping both here means the two can differ where they must and are renamed
 * together where they must not drift.
 */
const NAV = [
  { href: "/console", label: "Fleet", subject: "the fleet" },
  { href: "/console/new", label: "New agent", subject: "the new agent form" },
  { href: "/console/discover", label: "Discover", subject: "discovery" },
  { href: "/console/chat", label: "Chat", subject: "the console" },
  { href: "/console/treasury", label: "Treasury", subject: "the treasury" },
  { href: "/console/activity", label: "Activity", subject: "the activity log" },
] as const;

const isCurrent = (pathname: string, href: string) =>
  href === "/console"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);

/**
 * What the current screen is called, for anything completing a sentence about
 * it — today the connect gate's prompt.
 *
 * Derived from the same table and the same matcher the underline uses, which
 * is the point of exporting it rather than writing a second map somewhere
 * else: a screen renamed in `NAV` is renamed everywhere at once.
 *
 * A route with no entry falls back to "the console" — an agent's detail page is
 * the one that does, since `isCurrent` matches `/console` exactly and so lights
 * no tab there either. "Connect a wallet to use the console" is true on that
 * page and the fallback is not worth a special case; what it must not be is
 * blank, because every caller is completing a sentence.
 */
export function screenSubject(pathname: string): string {
  return (
    NAV.find((item) => isCurrent(pathname, item.href))?.subject ?? "the console"
  );
}

export function ConsoleNav() {
  const pathname = usePathname();

  return (
    <HStack as="nav" gap={4}>
      {NAV.map((item) => {
        const current = isCurrent(pathname, item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className="nav-link"
            aria-current={current ? "page" : undefined}
            data-active={current ? "" : undefined}
          >
            {/*
              Colour is the only thing that changes on the label. A heavier
              weight on the current item was tried and reverted: `medium`
              advances wider than `normal`, so every link to the right of the
              current one shifted as you navigated, and the nav appeared to
              breathe. Emphasis that moves its neighbours is not emphasis.
            */}
            <Text
              type="body"
              size="sm"
              color={current ? "primary" : "secondary"}
            >
              {item.label}
            </Text>
          </Link>
        );
      })}
    </HStack>
  );
}
