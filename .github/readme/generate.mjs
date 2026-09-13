// Source for the README header SVGs and the mdx-graphs figures.
//
//   node .github/readme/generate.mjs
//
// Rewrites every SVG in this folder and prints the two fenced figures for
// pasting into README.md. The header layout follows github.com/terkelg/terkelg
// (stacked <picture> strips floated left). Each strip is a light/dark pair
// because GitHub strips <style> from rendered SVG, so one file cannot switch
// its own fill. Attributes only, system monospace only, no external refs.
//
// The figures are the official fenced ASCII from https://mdx-graphs.kshv.me:
// the frame is theirs, only the labels are ours. The title rule is checked
// against their published frames before anything is printed.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = dirname(fileURLToPath(import.meta.url));

const MONO =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, &quot;Liberation Mono&quot;, monospace';
// Neutrals match apps/web/public/brand; allow/deny are the console's data
// green and red from apps/web/nymspace.css.
const THEMES = {
  light: { fg: "#0a0a0a", muted: "#737373", edge: "#c8c8c8", allow: "#0B991F", deny: "#E5283F" },
  dark: { fg: "#fafafa", muted: "#a3a3a3", edge: "#484848", allow: "#24BB5E", deny: "#F5394F" },
};
const MARK =
  "M6 2h20a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4Zm10 8a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const svg = (w, h, label, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}">\n` +
  `  <title>${esc(label)}</title>\n${body}\n</svg>\n`;
const text = (x, y, s, { size = 12, fill, anchor = "start", ls = 0 } = {}) =>
  `  <text x="${x}" y="${y}" fill="${fill}" font-family="${MONO}" font-size="${size}"` +
  (ls ? ` letter-spacing="${ls}"` : "") +
  (anchor !== "start" ? ` text-anchor="${anchor}"` : "") +
  `>${esc(s)}</text>`;
const hline = (x1, x2, y, stroke, dash) =>
  `  <path d="M${x1} ${y}H${x2}" stroke="${stroke}" stroke-width="1" stroke-dasharray="${dash}" fill="none"/>`;
const vline = (x, y1, y2, stroke, dash) =>
  `  <path d="M${x} ${y1}V${y2}" stroke="${stroke}" stroke-width="1" stroke-dasharray="${dash}" fill="none"/>`;
const plus = (x, y, stroke) =>
  `  <path d="M${x - 4} ${y}H${x + 4}M${x} ${y - 4}V${y + 4}" stroke="${stroke}" stroke-width="1.25"/>`;

function top(t) {
  const W = 880, H = 32;
  return svg(W, H, "Nymspace, ETHOnline 2026, ENSv2 Sepolia and Base Sepolia", [
    text(0, 16, "NYMSPACE  /  ETHONLINE 2026", { size: 10, fill: t.fg, ls: 1.5 }),
    hline(232, 520, 12, t.edge, "3 3"),
    text(W, 16, "ENSv2 SEPOLIA 11155111  ·  BASE SEPOLIA 84532", { size: 10, fill: t.muted, ls: 1.2, anchor: "end" }),
  ].join("\n"));
}

const LINKS = [
  { slug: "demo", label: "DEMO SCRIPT" },
  { slug: "architecture", label: "ARCHITECTURE" },
  { slug: "evidence", label: "EVIDENCE" },
  { slug: "run", label: "RUN LOCALLY" },
];
// The border sits 4px inside the canvas so its + corners are not clipped,
// and the transparent strip on the right is the gap between floated pills,
// since GitHub strips any margin you would set instead.
function pill(t, label) {
  const W = 140, H = 30, x0 = 4.5, x1 = 124.5, y0 = 4.5, y1 = H - 4.5;
  return svg(W, H, label.toLowerCase(), [
    `  <rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" stroke="${t.edge}" stroke-dasharray="3 3"/>`,
    plus(x0, y0, t.muted), plus(x1, y0, t.muted), plus(x0, y1, t.muted), plus(x1, y1, t.muted),
    text((x0 + x1) / 2, 19, label, { size: 10, fill: t.fg, ls: 1.4, anchor: "middle" }),
  ].join("\n"));
}

// The console's framed surface: dashed edge, + corners, bracketed title
// notched into the top edge (apps/web/components/console/frame.tsx).
function hero(t) {
  const W = 880, H = 312;
  const L = 8.5, R = W - 8.5, T = 12.5, B = H - 12.5;
  const title = "[ NYMSPACE ]";
  const tx = 36, tw = title.length * 7.8 + 16;
  const rx = 484, rEnd = R - 28;
  const row = (y, left, right) =>
    [text(rx, y, left, { size: 13, fill: t.fg }), right ? text(rEnd, y, right, { size: 11, fill: t.muted, anchor: "end" }) : ""]
      .filter(Boolean).join("\n");
  const grant = (y, record, verdict, ok) => [
    `  <circle cx="${rx + 4}" cy="${y - 4.5}" r="3.5" fill="${ok ? t.allow : t.deny}"/>`,
    text(rx + 18, y, record, { size: 13, fill: t.fg }),
    text(rEnd, y, verdict, { size: 11, fill: ok ? t.allow : t.deny, anchor: "end", ls: 0.6 }),
  ].join("\n");
  return svg(W, H, "One namespace. Many agents. Explicit authority.", [
    hline(L, tx - 8, T, t.edge, "4 4"),
    hline(tx - 8 + tw, R, T, t.edge, "4 4"),
    hline(L, R, B, t.edge, "4 4"),
    vline(L, T, B, t.edge, "4 4"),
    vline(R, T, B, t.edge, "4 4"),
    plus(L, T, t.muted), plus(R, T, t.muted), plus(L, B, t.muted), plus(R, B, t.muted),
    text(tx, T + 4, title, { size: 12, fill: t.fg, ls: 1 }),
    `  <g transform="translate(40 44) scale(1.25)"><path fill="${t.fg}" fill-rule="evenodd" d="${MARK}"/></g>`,
    text(40, 138, "One namespace.", { size: 28, fill: t.muted }),
    text(40, 176, "Many agents.", { size: 28, fill: t.muted }),
    text(40, 214, "Explicit authority.", { size: 28, fill: t.fg }),
    text(40, 252, "ENSv2 subnames · record-scoped grants", { size: 12, fill: t.muted }),
    text(40, 272, "ERC 8004 identity · Privy spend policy", { size: 12, fill: t.muted }),
    vline(452, 36, H - 36, t.edge, "2 4"),
    text(rx, 56, "NAMES", { size: 10, fill: t.muted, ls: 1.5 }),
    row(84, "nymspace.eth", "organization"),
    row(108, "├─ research.", "erc 8004 agent 9209"),
    row(132, "├─ trader."),
    row(156, "└─ deploy."),
    hline(rx, rEnd, 178, t.edge, "2 4"),
    text(rx, 204, "AGENT KEY WRITES", { size: 10, fill: t.muted, ls: 1.5 }),
    grant(232, "agent-endpoint[mcp]", "ALLOWED", true),
    grant(256, "agent-context", "REVERTS", false),
    grant(280, "agent-registration[…]", "REVERTS", false),
  ].join("\n"));
}

for (const [name, t] of Object.entries(THEMES)) {
  writeFileSync(join(OUT, `top-${name}.svg`), top(t));
  writeFileSync(join(OUT, `hero-${name}.svg`), hero(t));
  for (const l of LINKS) writeFileSync(join(OUT, `link-${l.slug}-${name}.svg`), pill(t, l.label));
}

// mdx-graphs frames are 52 columns: 50 inside, 48 of content, title centred
// with the odd dash on the right.
const OFFICIAL = [
  ["WHAT THE RESEARCH COST", "+----------- [ WHAT THE RESEARCH COST ] -----------+"],
  ["LAUNCH", "+------------------- [ LAUNCH ] -------------------+"],
  ["SHIPPED", "+------------------ [ SHIPPED ] -------------------+"],
  ["RFC", "+-------------------- [ RFC ] ---------------------+"],
  ["REGISTRY", "+------------------ [ REGISTRY ] ------------------+"],
];
const head = (title) => {
  const tok = ` [ ${title} ] `, rem = 50 - tok.length, left = Math.floor(rem / 2);
  return "+" + "-".repeat(left) + tok + "-".repeat(rem - left) + "+";
};
for (const [title, frame] of OFFICIAL) {
  if (head(title) !== frame) throw new Error(`title rule drifted from mdx-graphs: ${frame}`);
}
const fence = (title, rows) => {
  const body = rows.map((r) => {
    const n = [...r].length;
    if (n > 48) throw new Error(`row is ${n} columns, max 48: ${r}`);
    return "| " + r + " ".repeat(48 - n) + " |";
  });
  const blank = "|" + " ".repeat(50) + "|";
  return ["```", head(title), blank, ...body, blank, "+" + "-".repeat(50) + "+", "```"].join("\n");
};

console.log(fence("SPONSOR GATES", [
  "[x]  ens         gate a  10/10",
  "[x]  the graph   gate b   7/7",
  "[x]  privy       gate c  10/10",
  "[x]  google adk  gate f  10/10",
  "[x]  google adk  gate g   7/7",
]));
console.log();
console.log(fence("WORKSPACE", [
  "nymspace",
  "├─ apps",
  "│  ├─ web       next.js console     :3111",
  "│  └─ api       hono, /v1 routes    :3112",
  "└─ packages",
  "   ├─ core      types, public env",
  "   ├─ ens       ensv2 reads, writes",
  "   ├─ graph     agent0 subgraph",
  "   ├─ privy     wallet, policy",
  "   ├─ adk       console chat router",
  "   ├─ github    build log feed",
  "   └─ store     postgres coordination",
]));
