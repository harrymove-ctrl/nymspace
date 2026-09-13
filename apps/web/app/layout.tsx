import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ConsolePreloader } from "@/components/reality-split/console-preloader";
import { ThemeProvider } from "@/components/theme-provider";
import { SoundEffects } from "@/components/ui/sound";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const title = "Nymspace — ENS as the identity layer";
const description =
  "I would make ENS the identity layer, then choose partners that naturally become the data and execution layers.";

/**
 * `WEB_ORIGIN` is the comma-separated allowlist `docs/19_ENV_AND_CONFIG.md`
 * defines for CORS; its first entry is this deployment's own origin, which is
 * what `metadataBase` needs. Reusing it keeps one variable authoritative for
 * "where the web app lives" rather than adding a second that can drift.
 *
 * `metadataBase` is what turns the relative `opengraph-image` URL into the
 * absolute one crawlers require. Without it Next warns and falls back to
 * localhost, which ships a card no scraper can fetch.
 */
const siteUrl = (process.env.WEB_ORIGIN ?? "http://localhost:3111")
  .split(",")[0]
  .trim();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  openGraph: {
    type: "website",
    siteName: "Nymspace",
    url: "/",
    title,
    description,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // next-themes writes the class before paint; React would otherwise warn
      // about the server/client markup differing.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider
          // Two attributes from one store: `class` for Tailwind and shadcn,
          // `data-theme` for Astryx, whose reset maps it to `color-scheme`.
          // Both are written by next-themes' pre-paint inline script, so the
          // two systems agree on the first frame rather than after hydration.
          attribute={["class", "data-theme"]}
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/*
            One listener for the whole app, which is what makes the cues a
            property of the interface rather than of the components that
            remembered to ask for them.

            `SoundEffects` binds capturing `pointerdown` / `keydown` handlers on
            the document and classifies the event target on its way up, so a
            control added tomorrow is already audible and nothing has to thread
            a prop down to it. What a control sounds like is read from what it
            already tells the platform — `aria-expanded`, `aria-checked`, `role`
            — plus the `data-variant` every Astryx component reflects; a call
            site only writes `data-sound` where that reading is wrong.

            Nothing plays until the viewer has interacted with the page: the
            browser holds the AudioContext suspended until then, so the first
            press of a session is silent by design. Cues are on from there, and
            off for good for anyone who presses the toggle in either header —
            the choice lives in `localStorage`, so it survives the reload.
          */}
          <SoundEffects>{children}</SoundEffects>
          {/*
            Mounted by the layout rather than by the landing page, because the
            overlay has to outlive the navigation it covers: rendered from the
            page it would unmount the moment the router left `/`. It renders
            nothing until the Console link fires its event.
          */}
          <ConsolePreloader />
        </ThemeProvider>
      </body>
    </html>
  );
}
