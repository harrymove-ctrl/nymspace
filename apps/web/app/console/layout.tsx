import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { SoundToggle } from "@/components/ui/sound";
import { ConsoleNav } from "@/components/console/nav";
import { DecryptGate } from "@/components/console/decrypt-gate";
import { ViewTransition } from "@/components/console/view-transition";
import { ConnectVisitor, VisitorProvider } from "@/components/console/visitor";

/**
 * The console shell.
 *
 * Fleet, Discover and Activity, which is the navigation `docs/03` calls
 * mandatory plus the one it calls recommended; Chat and Treasury are the two
 * the product added. Settings is deliberately absent: the spec allows it to be
 * minimal, and an empty settings page is a promise the product does not keep.
 *
 * The links themselves live in `components/console/nav.tsx`, which needs the
 * pathname to mark the current one and so cannot be a server component.
 *
 * `surface-body` paints the Astryx body token rather than leaving the shell on
 * the shadcn `--background` the landing page uses. Two token systems both claim
 * "the page background", and a Frame punches its edge with the Astryx one:
 * unreconciled, the punch is a visibly tinted lozenge behind every title.
 * Painting the shell here reconciles them inside the console without touching
 * the landing page.
 *
 * ## Two elements, because a surface and a column are two jobs
 *
 * The outer one paints and is full-bleed; the inner one is the 72rem measure
 * and is transparent. One element doing both meant the paint stopped where the
 * column stopped, so on any viewport wider than 72rem the console sat as a
 * tinted stripe between two white margins — the body showing through, still
 * wearing the landing page's background. A reading measure is a constraint on
 * line length, never on where the page's colour reaches.
 */

export const metadata = {
  title: "Nymspace console",
  description:
    "Agent identity on ENSv2, discovery over live ERC 8004 data, and payments inside an enforced policy.",
};

export default function ConsoleLayout({ children }: LayoutProps<"/console">) {
  return (
    /*
      The surface paints the viewport; the content is what is centred.

      These were one element, so `surface-body` was painted only across the
      72rem column. On anything wider that left the console as a lighter slab
      — rgb(16,16,24) in dark — floating on the body's near-black, with a
      visible band down each side and another under the fold. In light it was
      the reverse: a tinted stripe between two white margins, the body still
      wearing the landing page's shadcn `--background`. Two grounds that were
      never meant to be seen together, and the seam moved with the viewport.

      Splitting them means the surface has no width of its own to disagree
      about: it fills, and `maxWidth` constrains only the column inside it.

      A VStack rather than a div: `AGENTS.md` gives the raw-layout exception to
      `Frame` by name, and nothing here needs one.
    */
    <VStack width="100%" minHeight="100vh" className="surface-body">
      {/*
        The provider wraps the whole console rather than the one page that
        reads from it, because the connect control lives in this header and the
        authority table lives on an agent's page — two subtrees, one session. It
        is a pass-through when `NEXT_PUBLIC_PRIVY_APP_ID` is unset, so a clone
        without credentials renders exactly as before.
      */}
      <VisitorProvider>
        <VStack
          gap={8}
          paddingInline={6}
          paddingBlock={8}
          maxWidth="72rem"
          width="100%"
          className="mx-auto min-w-0"
        >
          <HStack
            as="header"
            gap={6}
            justify="between"
            align="center"
            paddingBlockEnd={4}
            className="frame-rule-below"
          >
            <HStack gap={6} align="end">
              <Link href="/">
                <Text type="code" size="xsm" color="secondary">
                  NYMSPACE
                </Text>
              </Link>
              <ConsoleNav />
            </HStack>
            <HStack gap={4} align="center">
              <ConnectVisitor />
              {/*
                Next to the theme toggle because they are the same kind of
                switch: two viewer preferences about how the console presents
                itself, both stored locally, neither of them state the product
                has an opinion about. The control is also the only place the
                interface admits it makes sound at all, so it belongs where a
                viewer already looks for the settings that are not settings.
              */}
              <SoundToggle />
              <ThemeToggle />
            </HStack>
          </HStack>
        {/*
          Only the screen fades. The header and nav sit outside, because chrome
          that re-animates on every navigation reads as the whole page reloading
          rather than as the content changing.

          The gate sits in the same place and for a related reason. Every
          console screen is withheld from a visitor who has not connected, and
          putting that in the layout is what makes it true of all of them —
          including a screen added next month, which is the case a per-page
          wrapper gets wrong by omission rather than by argument. It also keeps
          the count at one: Treasury and an agent's page carry three and five
          frames each, and gating each frame would stack three and five
          identical "connect" prompts down a single screen.

          Inside the transition, so the veil fades in with the screen it veils
          rather than sitting still while the content moves underneath it.

          The header stays outside and stays crisp. The nav is how you see what
          the console has, the Connect button beside it is the way through, and
          enciphering either would be locking the door and hiding the handle.
        */}
          <ViewTransition>
            <DecryptGate minHeight="24rem">{children}</DecryptGate>
          </ViewTransition>
        </VStack>
      </VisitorProvider>
    </VStack>
  );
}
