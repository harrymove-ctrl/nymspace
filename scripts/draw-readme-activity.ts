/**
 * Draws the README's build-log strip: this repo's commits per day as a
 * contribution grid, the totals beside it, and the latest three commits.
 *
 * The data is `getActivity()` from `@nymspace/github`, the same read behind the
 * landing page's build log, so the README and the site cannot disagree about a
 * count. The look follows `.github/readme/generate.mjs`: the console's framed
 * surface, attributes only, one light and one dark file, because GitHub strips
 * <style> from rendered SVG.
 *
 * A GitHub failure exits non-zero before anything is written. The package
 * withholds numbers rather than report zero, and so does this: the workflow
 * then publishes nothing and the README keeps its last good picture.
 *
 * Run: pnpm readme:activity <out-dir>
 * Scheduled by .github/workflows/readme-activity.yml, which publishes the
 * output to the `readme-assets` branch.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getActivity } from "@nymspace/github";

type Activity = Awaited<ReturnType<typeof getActivity>>;

const WEEKS = 26;
const MONO =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, &quot;Liberation Mono&quot;, monospace';
// The landing page's accent and level ramp (apps/web/components/commit-activity.tsx,
// LEVEL_OPACITY in apps/web/components/ui/github-activity.tsx). Level 0 is drawn
// as an outline instead, so the grid still reads on a transparent ground.
const ACCENT = "#39d353";
const LEVEL_OPACITY = [0, 0.3, 0.52, 0.76, 1] as const;

type Theme = { fg: string; muted: string; edge: string; empty: string };
const THEMES: Record<"light" | "dark", Theme> = {
  light: { fg: "#0a0a0a", muted: "#737373", edge: "#c8c8c8", empty: "#d4d4d4" },
  dark: { fg: "#fafafa", muted: "#a3a3a3", edge: "#484848", empty: "#333333" },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clip = (s: string, n: number) => {
  const chars = [...s];
  return chars.length > n ? chars.slice(0, n - 1).join("") + "…" : s;
};
const month = (iso: string) => MONTHS[new Date(iso).getUTCMonth()] ?? "";
const day = (iso: string) => `${month(iso)} ${String(new Date(iso).getUTCDate()).padStart(2, "0")}`;

type TextOptions = { size?: number; fill: string; anchor?: "middle" | "end"; ls?: number };
const text = (x: number, y: number, s: string, o: TextOptions) =>
  `  <text x="${x}" y="${y}" fill="${o.fill}" font-family="${MONO}" font-size="${o.size ?? 12}"` +
  (o.ls ? ` letter-spacing="${o.ls}"` : "") +
  (o.anchor ? ` text-anchor="${o.anchor}"` : "") +
  `>${esc(s)}</text>`;
const dashed = (d: string, stroke: string, dash: string) =>
  `  <path d="${d}" stroke="${stroke}" stroke-width="1" stroke-dasharray="${dash}" fill="none"/>`;
const plus = (x: number, y: number, stroke: string) =>
  `  <path d="M${x - 4} ${y}H${x + 4}M${x} ${y - 4}V${y + 4}" stroke="${stroke}" stroke-width="1.25"/>`;

function draw(a: Activity, t: Theme): string {
  const W = 880, H = 348;
  const L = 8.5, R = W - 8.5, T = 12.5, B = H - 12.5;
  const title = "[ BUILD LOG ]";
  const tx = 36, tw = title.length * 7.8 + 16;
  const commits = Object.values(a.commitsByDate)
    .flat()
    .sort((x, y) => y.date.localeCompare(x.date));
  const total = a.truncated ? `${a.totalCommits}+` : String(a.totalCommits);

  const out = [
    dashed(`M${L} ${T}H${tx - 8}M${tx - 8 + tw} ${T}H${R}M${L} ${B}H${R}M${L} ${T}V${B}M${R} ${T}V${B}`, t.edge, "4 4"),
    plus(L, T, t.muted), plus(R, T, t.muted), plus(L, B, t.muted), plus(R, B, t.muted),
    text(tx, T + 4, title, { fill: t.fg, ls: 1 }),
  ];

  // Sunday-aligned columns, one per week, as getActivity builds them.
  const X0 = 40, Y0 = 44, CELL = 16, STEP = 20;
  const today = new Date().toISOString().slice(0, 10);
  a.contributions.forEach((c, i) => {
    if (c.date > today) return; // GitHub leaves the rest of this week blank too
    const x = X0 + Math.floor(i / 7) * STEP, y = Y0 + (i % 7) * STEP;
    out.push(
      c.level === 0
        ? `  <rect x="${x + 0.5}" y="${y + 0.5}" width="${CELL - 1}" height="${CELL - 1}" rx="3" fill="none" stroke="${t.empty}"/>`
        : `  <rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="3" fill="${ACCENT}" fill-opacity="${LEVEL_OPACITY[c.level]}"/>`,
    );
  });

  // A month label where a column starts a new month; the first column only
  // when its month runs long enough that the next label cannot collide.
  const cols = Math.ceil(a.contributions.length / 7);
  const monthOf = (col: number) => {
    const c = a.contributions[col * 7];
    return c ? month(c.date) : "";
  };
  for (let col = 0; col < cols; col++) {
    const m = monthOf(col);
    const starts = col === 0 ? monthOf(3) === m : m !== monthOf(col - 1);
    if (starts) out.push(text(X0 + col * STEP, Y0 + 7 * STEP + 12, m, { size: 10, fill: t.muted }));
  }

  const latest = commits[0];
  const stats: [string, string][] = [
    ["COMMITS", total],
    ["ACTIVE DAYS", String(a.contributions.filter((c) => c.count > 0).length)],
    ["CONTRIBUTORS", String(a.contributors.length)],
    ["LAST COMMIT", latest ? day(latest.date) : "none"],
  ];
  stats.forEach(([label, value], i) => {
    const x = 600 + (i % 2) * 130, y = 56 + Math.floor(i / 2) * 76;
    out.push(
      text(x, y, label, { size: 10, fill: t.muted, ls: 1.5 }),
      text(x, y + 32, value, { size: 26, fill: t.fg }),
    );
  });
  out.push(text(600, Y0 + 7 * STEP + 12, `last ${WEEKS} weeks · utc`, { size: 10, fill: t.muted }));

  out.push(
    dashed(`M40 216H${R - 28}`, t.edge, "2 4"),
    text(40, 242, "LATEST", { size: 10, fill: t.muted, ls: 1.5 }),
    text(R - 28, 242, `drawn ${a.fetchedAt.slice(0, 16).replace("T", " ")} utc`, { size: 10, fill: t.muted, anchor: "end" }),
  );
  // Merges are counted above like any commit, but listed they only say which
  // branch met which, so the three rows show the latest work instead.
  commits.filter((c) => !c.subject.startsWith("Merge ")).slice(0, 3).forEach((c, i) => {
    const y = 270 + i * 24;
    out.push(
      text(40, y, c.shortSha, { fill: t.muted }),
      text(112, y, day(c.date), { fill: t.muted }),
      text(176, y, clip(c.subject, 84), { size: 13, fill: t.fg }),
    );
  });

  const label = `Build log: ${total} commits in the last ${WEEKS} weeks`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">\n` +
    `  <title>${esc(label)}</title>\n${out.join("\n")}\n</svg>\n`
  );
}

async function main() {
  const outDir = process.argv.slice(2).find((arg) => arg !== "--");
  if (!outDir) {
    console.error("usage: pnpm readme:activity <out-dir>");
    process.exit(2);
  }

  const activity = await getActivity(WEEKS);
  if (activity.error) {
    console.error(`readme:activity: ${activity.error.message}`);
    process.exit(1);
  }

  const dir = resolve(outDir);
  mkdirSync(dir, { recursive: true });
  for (const [name, theme] of Object.entries(THEMES)) {
    writeFileSync(join(dir, `activity-${name}.svg`), draw(activity, theme));
  }
  console.log(`readme:activity: ${activity.totalCommits}${activity.truncated ? "+" : ""} commits drawn to ${dir}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
