/**
 * Which model routes, and how fast — design OQ3.
 *
 * Run:    pnpm --filter @nymspace/adk measure:routing
 * Emits:  packages/adk/evidence/routing-models.json
 *
 * The pinned model is a measurement, not a preference, and this is the
 * measurement. It exists for the reason `RANKING_MODEL`'s comment gives: the
 * first choice there was the newest stable flash, and three of six acceptance
 * runs failed on 429s and 503s from that one step. A model that is newer and
 * refuses to answer ranks below an older one that responds.
 *
 * Three attempts per model, spaced. The spacing is not politeness — the first
 * live Gate F run fired eight calls back to back and collected two provider
 * errors, which is a measurement of this script's own impatience rather than
 * of the model.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  createAdkRouter,
  ROUTING_MODEL,
  type ChatRouting,
  type RouterFleet,
} from "../src/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_PATH = resolve(HERE, "..", "evidence", "routing-models.json");

/**
 * Stable names only. A `-latest` alias moves, which is precisely what pinning
 * exists to prevent, and a `-preview` one is withdrawn on someone else's
 * schedule.
 */
const DEFAULT_CANDIDATES = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
];

/**
 * Overridable, because re-measuring two finalists is a different job from
 * surveying the field, and the survey takes eight minutes.
 */
const CANDIDATES = (process.env["ROUTING_CANDIDATES"] ?? DEFAULT_CANDIDATES.join(","))
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

const ATTEMPTS = Number(process.env["ROUTING_ATTEMPTS"] ?? 3);
const SPACING_MS = 2_000;
/** Long enough to measure the model rather than the console's budget. */
const MEASURE_TIMEOUT_MS = 25_000;

const FLEET: RouterFleet = {
  parentName: "nymspace.eth",
  agents: [
    { id: "agent-research", slug: "research", ensName: "research.nymspace.eth" },
    { id: "agent-support", slug: "support", ensName: "support.nymspace.eth" },
    { id: "agent-billing", slug: "billing", ensName: "billing.nymspace.eth" },
  ],
};

/**
 * Two questions, because a model that places one and not the other has not
 * been shown to route. The first is the sentence from the deployed console;
 * the second has to reach a specific agent out of three, which is the
 * selection the enum exists for.
 */
const REQUESTS = [
  {
    label: "unmatched",
    message:
      "For the ENS tracks we ideally want to see projects that utilize ENS features in a meaningful and creative way. From your description it seems you're mostly using subnames currently?",
    expect: "show_fleet",
  },
  {
    label: "one-agent",
    message: "how is the billing one set up, and what is it allowed to write",
    expect: "show_agent:agent-billing",
  },
];

function outcome(routing: ChatRouting): string {
  if (routing.kind === "call") {
    return "agentId" in routing.call
      ? `${routing.tool}:${routing.call.agentId}`
      : routing.tool;
  }
  return `miss:${routing.reason}${routing.providerCode ? `(${routing.providerCode})` : ""}`;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

interface Row {
  model: string;
  correct: number;
  answered: number;
  attempts: number;
  latencyMs: number[];
  medianMs: number | null;
  outcomes: string[];
}

async function main(): Promise<void> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) {
    console.error("GEMINI_API_KEY is required to measure anything.");
    process.exitCode = 1;
    return;
  }

  const rows: Row[] = [];

  for (const model of CANDIDATES) {
    const router = createAdkRouter({ apiKey, model, timeoutMs: MEASURE_TIMEOUT_MS });
    const row: Row = {
      model,
      correct: 0,
      answered: 0,
      attempts: 0,
      latencyMs: [],
      medianMs: null,
      outcomes: [],
    };

    for (let i = 0; i < ATTEMPTS; i += 1) {
      for (const request of REQUESTS) {
        const routing = await router.route({ message: request.message, fleet: FLEET });
        const got = outcome(routing);

        row.attempts += 1;
        row.outcomes.push(`${request.label}=${got}`);
        if (routing.kind === "call") {
          row.answered += 1;
          row.latencyMs.push(routing.elapsedMs);
          if (got === request.expect) row.correct += 1;
        }

        await sleep(SPACING_MS);
      }
    }

    const sorted = [...row.latencyMs].sort((a, b) => a - b);
    row.medianMs = sorted.length ? (sorted[Math.floor(sorted.length / 2)] ?? null) : null;
    rows.push(row);

    console.log(
      `${model.padEnd(24)} ${row.correct}/${row.attempts} correct  ` +
        `${row.answered}/${row.attempts} answered  ` +
        `median ${row.medianMs ?? "—"}ms  [${row.latencyMs.join(", ")}]`,
    );
  }

  /**
   * Is a second attempt worth the wait — tasks.md 9.5.
   *
   * The pinned model places seven of ten, and it misses by producing an empty
   * turn. An empty turn is not obviously deterministic, so the question is
   * whether asking again places it, and what that costs the one operator who
   * is already waiting the longest.
   *
   * Measured rather than argued: the same question, repeatedly, retried once
   * whenever the first attempt comes back `no_call`.
   */
  const retryRouter = createAdkRouter({
    apiKey,
    model: ROUTING_MODEL,
    timeoutMs: MEASURE_TIMEOUT_MS,
  });
  const retry = {
    model: ROUTING_MODEL,
    attempts: 0,
    placedFirst: 0,
    retried: 0,
    placedOnRetry: 0,
    firstMs: [] as number[],
    retryMs: [] as number[],
  };

  const unmatched = REQUESTS[0];
  if (unmatched) {
    for (let i = 0; i < 12; i += 1) {
      const first = await retryRouter.route({ message: unmatched.message, fleet: FLEET });
      retry.attempts += 1;
      retry.firstMs.push(first.elapsedMs);

      if (first.kind === "call") {
        retry.placedFirst += 1;
      } else if (first.reason === "no_call") {
        await sleep(SPACING_MS);
        const second = await retryRouter.route({ message: unmatched.message, fleet: FLEET });
        retry.retried += 1;
        retry.retryMs.push(first.elapsedMs + second.elapsedMs);
        if (second.kind === "call") retry.placedOnRetry += 1;
      }

      await sleep(SPACING_MS);
    }

    console.log(
      `\nretry: ${retry.placedFirst}/${retry.attempts} placed first try, ` +
        `${retry.placedOnRetry}/${retry.retried} of the misses placed on a second, ` +
        `costing ${retry.retryMs.join(", ")}ms`,
    );
  }

  mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
  writeFileSync(
    EVIDENCE_PATH,
    `${JSON.stringify(
      { ranAt: new Date().toISOString(), attempts: ATTEMPTS, requests: REQUESTS, rows, retry },
      null,
      2,
    )}\n`,
  );
  console.log(`\nevidence: ${EVIDENCE_PATH}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
