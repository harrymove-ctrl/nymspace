import { serve } from "@hono/node-server";
import { createApp, type AppType } from "./app";
import { apiConfig } from "./config";
import { assertChatRouterConfigured } from "./deps";
import { createLog, errorFields, stdoutSink } from "./log";

/**
 * The Nymspace API.
 *
 * Hono over web-standard Request and Response, the same primitives the Next
 * route handlers use, so a handler moves between the two without a rewrite.
 * Domain logic is imported from the workspace packages rather than
 * reimplemented — docs/17_RISKS_AND_FALLBACKS.md Risk 1 asks for one blast
 * radius when the ENSv2 beta moves, and two servers sharing one package still
 * counts as one.
 *
 * Run with `--conditions=react-server`. The packages guard their entrypoints
 * with `server-only`, whose exports map answers that condition and no other;
 * without the flag every guarded import dies with a misleading "Client
 * Component" error. `pnpm conditions:check` enforces it.
 *
 * This module is the process, not the application. Everything testable lives in
 * `app.ts`, which binds no socket.
 */
const config = apiConfig();

/**
 * The routing credential, resolved before the socket opens.
 *
 * `GEMINI_API_KEY` is optional — without it the console chat answers exactly
 * what its matcher recognises and nothing else, which is a supported way to
 * run. A key the provider client refuses is a different thing, and it used to
 * surface as a 500 on the first unmatched question and every one after it.
 * Failing here instead is `docs/19`'s startup-validation rule: a
 * misconfiguration should stop a deployment, not quietly degrade it.
 *
 * Caught, rather than left to Node. An uncaught throw at module scope prints
 * the multi-line stack this repo bans from `apps/api/src` for the reason
 * `log.ts` gives — Railway splits it into unrelated entries with no request id
 * and no variable name, so the operator gets the loudest possible failure in
 * the least readable format. One flat line says which variable, and the exit
 * code is what actually stops the deploy.
 */
const boot = createLog(stdoutSink);

let routing = false;
try {
  routing = assertChatRouterConfigured();
} catch (error) {
  boot.error("GEMINI_API_KEY is set but the routing provider refused it", {
    variable: "GEMINI_API_KEY",
    ...errorFields(error),
  });
  process.exit(1);
}

const app = createApp(config);

serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  boot.info(`@nymspace/api listening on http://localhost:${port}`, {
    port,
    // So a deployment answering only matcher questions says so in line one,
    // rather than being diagnosed from the absence of routed answers.
    chatRouting: routing,
  });
});

export { app, type AppType };
