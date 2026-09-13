/**
 * Fail when a non-Next entrypoint runs without the `react-server` export
 * condition.
 *
 * Why this exists: the `server-only` package exports
 * `{"react-server": "./empty.js", "default": "./index.js"}`, and `index.js`
 * throws at module scope. Next resolves `react-server` for its server graph and
 * the throwing module for client bundles, which is the build-time guard the
 * monorepo-workspace spec asks for. Every other consumer — a standalone server,
 * a script under tsx — also resolves the throwing module, so importing
 * `@nymspace/ens` outside Next dies with:
 *
 *   "This module cannot be imported from a Client Component module."
 *
 * in a process that has no components at all. That message sends you looking at
 * bundling. The fix is one flag, and this check is what stops the flag being
 * forgotten.
 *
 * Run: pnpm conditions:check
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const REQUIRED_FLAG = "--conditions=react-server";

/** Runtimes that resolve export conditions themselves, unlike `next`. */
const RUNTIMES = ["tsx", "node"];

interface Offence {
  packageName: string;
  scriptName: string;
  command: string;
}

function workspaceManifests(): string[] {
  const found = [join(root, "package.json")];

  for (const group of ["apps", "packages"]) {
    const dir = join(root, group);
    if (!existsSync(dir)) continue;

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = join(dir, entry.name, "package.json");
      if (existsSync(manifest)) found.push(manifest);
    }
  }
  return found;
}

/**
 * True when the command hands a source file to a runtime that resolves export
 * conditions. `next dev` is excluded because Next sets its own conditions; a
 * bare `tsc` or `vitest` is excluded because neither takes an entrypoint this
 * way. Vitest resolves conditions through its own config instead.
 *
 * Build *output* is excluded too. A bundle has its conditions resolved at the
 * moment it was built — `server-only` is already gone from `dist/index.js`,
 * replaced by whatever the bundler picked — so a runtime flag there changes
 * nothing and asserting on it would be a check nobody could act on.
 */
function entrypointOf(command: string): string | undefined {
  const tokens = command.split(/\s+/).filter(Boolean);
  const runtimeIndex = tokens.findIndex((token) => RUNTIMES.includes(token));
  if (runtimeIndex === -1) return undefined;

  return tokens
    .slice(runtimeIndex + 1)
    .find((token) => /\.(ts|tsx|mts|js|mjs)$/.test(token) && !/(^|\/)dist\//.test(token));
}

/**
 * True when the condition is handled, by the command or by the entrypoint.
 *
 * The flag is the usual way. The other way is a file that configures the
 * condition itself — `apps/api/scripts/build.mjs` passes
 * `conditions: ["react-server"]` to esbuild, which is where it has to be,
 * because esbuild resolves the app's imports rather than Node — and a flag on
 * that script would be decoration. Reading the entrypoint is how this check
 * tells "handled somewhere else" from "forgotten", which is the whole thing it
 * is for.
 */
function hasCondition(command: string, entrypoint: string, manifestPath: string): boolean {
  if (command.includes(REQUIRED_FLAG)) return true;

  const file = resolve(dirname(manifestPath), entrypoint);
  if (!existsSync(file)) return false;
  return readFileSync(file, "utf8").includes("react-server");
}

const offences: Offence[] = [];
let checked = 0;

for (const manifestPath of workspaceManifests()) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    name?: string;
    scripts?: Record<string, string>;
  };

  for (const [scriptName, command] of Object.entries(manifest.scripts ?? {})) {
    const entrypoint = entrypointOf(command);
    if (!entrypoint) continue;
    checked++;
    if (hasCondition(command, entrypoint, manifestPath)) continue;

    offences.push({
      packageName: manifest.name ?? manifestPath,
      scriptName,
      command,
    });
  }
}

if (offences.length === 0) {
  console.log(
    `conditions: ${checked} entrypoint script${checked === 1 ? "" : "s"} run with ${REQUIRED_FLAG}`,
  );
  process.exit(0);
}

console.error(
  `These scripts run a source entrypoint without ${REQUIRED_FLAG}. Importing a\n` +
    "guarded package from one of them fails with a message about Client\n" +
    "Components, in a process that has none:\n",
);
for (const offence of offences) {
  console.error(`  ${offence.packageName} → ${offence.scriptName}`);
  console.error(`    ${offence.command}\n`);
}

process.exit(1);
