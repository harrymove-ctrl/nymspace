/**
 * Gate G — the console chat, end to end, against a real model.
 *
 * Run:    pnpm --filter @nymspace/api verify:console-chat
 * Emits:  apps/api/evidence/gate-g.json
 *
 * Two suites already cover most of this and neither covers the join.
 * `packages/adk`'s Gate F drives a real Gemini and stops at the selection;
 * `src/routes/chat.test.ts` drives the whole route and stops at a fake router.
 * What neither exercises is a real model's selection arriving at a real
 * dispatch — the argument surviving `validateToolCall`, the lens builder
 * finding the agent the model named, the stage reaching the response body.
 * That join is where a rename or a reordered parameter would break silently:
 * both suites would stay green and the console would answer the wrong
 * question.
 *
 * The store is a fixture, deliberately. Postgres is not what this gate is
 * about, and one that needed a database would be a gate nobody runs before a
 * demo. Everything above the store is real: the HTTP request, the validator,
 * the matcher, the router, Gemini, the dispatch, the lens.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { createAdkRouter, ROUTING_MODEL } from "@nymspace/adk";
import { createApp } from "../src/app";
import type { Deps } from "../src/deps";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_PATH = resolve(HERE, "..", "evidence", "gate-g.json");

/** The question from the deployed console that this whole change exists for. */
const UNMATCHED =
  "For the ENS tracks we ideally want to see projects that utilize ENS features in a meaningful and creative way. From your description it seems you're mostly using subnames currently?";

const ADDRESS = "0x0000000000000000000000000000000000000001";
const CONTROLLER = "0xDEA25D2537cE06cE1073dd9621C70056CBDC3aEB";

const PROVISIONING = {
  ens: "active",
  erc8004: "registered",
  ensip25: "verified",
  graph: "indexed",
  financial: "policy_configured",
};

/**
 * Three agents, because one proves nothing.
 *
 * With a single agent every selection is the right selection and the enum the
 * model chooses from has one member. The billing agent is the one the
 * assertions ask for by description rather than by name.
 */
const AGENTS = ["research", "support", "billing"].map((slug) => ({
  id: `agent-${slug}`,
  organizationId: "nymspace",
  slug,
  ensName: `${slug}.nymspace.eth`,
  controllerAddress: CONTROLLER,
  provisioning: PROVISIONING,
}));

function fixtureDeps(chatRouter: Deps["chatRouter"]): Deps {
  return {
    chatRouter,
    store: {
      listAgents: async () => AGENTS,
      getAgent: async (id: string) => AGENTS.find((agent) => agent.id === id),
      listActivity: async () => [],
      getFinancialAuthority: async (id: string) => ({
        agentId: id,
        privyWalletId: "wallet-fixture",
        walletAddress: ADDRESS,
        policyId: "policy-fixture",
        policyLabel: "fixture spend limit",
      }),
    },
    /**
     * Every chain read answers with nothing, and that is enough here: this
     * gate asserts which lens was drawn and for whom, not what the resolver
     * said. `verify:matrix-live` is the one that reads chain.
     */
    ens: new Proxy(
      {},
      {
        get(_, key) {
          return async () => {
            if (key === "canSetText") return false;
            if (key === "findOwner" || key === "getResolver") return ADDRESS;
            return "";
          };
        },
      },
    ),
    config: { chainId: 11155111 },
    registry: ADDRESS,
    organization: ADDRESS,
    controller: CONTROLLER,
    parentName: "nymspace.eth",
  } as unknown as Deps;
}

interface Assertion {
  n: number;
  name: string;
  passed: boolean;
  detail: string;
}

const assertions: Assertion[] = [];

function assert(n: number, name: string, passed: boolean, detail: string): void {
  assertions.push({ n, name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${n}. ${name}\n      ${detail}`);
}

async function main(): Promise<void> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) {
    console.error("GEMINI_API_KEY is required: this gate is the one with a real model in it.");
    process.exitCode = 1;
    return;
  }

  /**
   * The log is kept, not discarded.
   *
   * The route renders a model decline and a provider timeout identically —
   * deliberately, because to an operator they are the same fact — which makes
   * the response body unable to tell assertion 6 what it needs to know. The
   * log already carries the distinction as `miss=no_call` against
   * `miss=timeout`, so the gate reads it there rather than asserting on a
   * shape that two different things produce.
   */
  const logLines: string[] = [];

  const app = createApp(
    { port: 0, allowedOrigins: [] },
    fixtureDeps(createAdkRouter({ apiKey })),
    (line) => logLines.push(line),
  );

  const runs: Record<string, unknown>[] = [];
  const spacing = () => new Promise((done) => setTimeout(done, 1_500));

  /**
   * One question, as the browser asks it.
   *
   * Retried on a provider condition and never on the model's own answer —
   * Gate F's rule, and the same reason: a verdict that moves with the
   * provider's latency is not measuring this code.
   */
  let providerRetries = 0;

  const ask = async (
    label: string,
    message: string,
    /**
     * What this question is for, which is the only way the gate can tell a
     * slow provider from a model doing its job.
     *
     * The response body is `unanswered` either way — the route deliberately
     * renders an outage and a decline the same, which is right for an
     * operator and useless for a retry rule. The first version of this helper
     * retried every `unanswered`, so the off-topic question the model is
     * *supposed* to decline was asked three times and counted two provider
     * retries, and `providerRetries` measured the model's correct behaviour
     * rather than the provider's weather. Gate F keeps the two apart by
     * reading the miss reason; here the gate knows what it expected.
     */
    expect: "placed" | "declined" = "placed",
  ) => {
    for (let attempt = 0; ; attempt += 1) {
      await spacing();
      // Requests are sequential, so everything logged after this mark belongs
      // to this one.
      const from = logLines.length;
      const response = await app.fetch(
        new Request("http://api.test/v1/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message }),
        }),
      );
      const status = response.status;
      const body = (await response.json()) as Record<string, unknown>;
      const lines = logLines.slice(from);
      runs.push({ label, message, status, body, lines });

      const slow =
        expect === "placed" &&
        body["kind"] === "unanswered" &&
        body["routedBy"] === "matcher" &&
        attempt < 2;
      if (!slow) return { status, body, lines };
      providerRetries += 1;
    }
  };

  const unmatched = await ask("unmatched", UNMATCHED);
  assert(
    1,
    "the question the deployed console refused is answered, over HTTP, by a model's selection",
    unmatched.status === 200 &&
      unmatched.body["kind"] === "lens" &&
      unmatched.body["routedBy"] === "model",
    `${unmatched.status} ${String(unmatched.body["kind"])} routedBy=${String(unmatched.body["routedBy"])} — ${String(unmatched.body["title"] ?? "")}`,
  );

  const matched = await ask("matched", "show research");
  assert(
    2,
    "a question the matcher knows is still answered by the matcher",
    matched.body["kind"] === "lens" &&
      matched.body["routedBy"] === "matcher" &&
      matched.body["title"] === "research.nymspace.eth",
    `${String(matched.body["kind"])} routedBy=${String(matched.body["routedBy"])} — ${String(matched.body["title"])}`,
  );

  const oneAgent = await ask(
    "one-agent",
    "which of these handles invoices, and what is it allowed to write",
  );
  assert(
    3,
    "a described agent reaches that agent's lens, not another's",
    oneAgent.body["kind"] === "lens" && oneAgent.body["title"] === "billing.nymspace.eth",
    `${String(oneAgent.body["kind"])} — ${String(oneAgent.body["title"] ?? oneAgent.body["message"])}`,
  );

  const history = await ask("history", "what has happened to research since it was set up");
  assert(
    4,
    "a question about history reaches the audit trail",
    history.body["kind"] === "lens" &&
      String(history.body["title"] ?? "").toLowerCase().includes("research"),
    `${String(history.body["kind"])} — ${String(history.body["title"] ?? "")}`,
  );

  /**
   * Deliberately names no agent and uses none of the matcher's verbs.
   *
   * "send … from research …" reaches the matcher, which is correct behaviour
   * and the wrong test: the first version of this assertion phrased it that
   * way, got `routedBy: "matcher"`, and proved nothing about the routing
   * stage. The matcher's own payment branch is pinned in `chat.test.ts`.
   */
  const pay = await ask(
    "pay",
    "move 0.0001 ether out of the one that handles invoices, to whoever owns it",
  );
  const steps = (pay.body["steps"] as { path?: string }[] | undefined) ?? [];
  assert(
    5,
    "a routed payment is a plan the operator has to accept, and nothing was sent",
    pay.body["kind"] === "plan" && steps.every((step) => typeof step.path === "string"),
    `${String(pay.body["kind"])} — ${steps.map((step) => step.path).join(", ") || String(pay.body["message"] ?? "")}`,
  );

  const offTopic = await ask(
    "off-topic",
    "what is the weather in Hanoi tomorrow",
    "declined",
  );
  const declined = offTopic.lines.some((line) => line.includes('"miss":"no_call"'));

  assert(
    6,
    "the model declines a question this console cannot answer, and the route returns a 200",
    /**
     * `no_call` specifically. Without reading the log this assertion passed on
     * a timeout as readily as on a decline, because the route renders both as
     * the unanswered state — so in one of this provider's slow windows it
     * would have recorded "the model refused to force a tool" for a run where
     * the model was never reached.
     */
    offTopic.status === 200 &&
      offTopic.body["kind"] === "unanswered" &&
      Array.isArray(offTopic.body["suggestions"]) &&
      declined,
    `${offTopic.status} ${String(offTopic.body["kind"])}, miss=${declined ? "no_call" : "not a decline"}`,
  );

  /**
   * The same intent, reached both ways, compared byte for byte.
   *
   * This is the assertion that makes "the model writes no part of an answer"
   * checkable rather than stated. If one sentence of model text reached a
   * title, a caption, a node label or a detail row, the routed answer and the
   * matched answer would differ — and they are produced by the same function
   * on the same reads, so anything that differs came from the model.
   *
   * `readAt` is excluded because the two requests happened at different
   * moments, and `routedBy` because saying which stage chose is the one thing
   * this change deliberately added.
   *
   * The first version of this assertion searched the bodies for first-person
   * text instead, and failed on the console's own `unrecognised()` copy — "so
   * I can only answer about things I can go and check", which is a string in
   * `chat.ts`. A heuristic that cannot tell the application's voice from a
   * model's was not measuring the thing it was named after.
   */
  const matchedFleet = await ask("fleet-matched", "show me the fleet");

  const comparable = (body: Record<string, unknown>) => {
    const { readAt: _readAt, routedBy: _routedBy, ...rest } = body;
    return JSON.stringify(rest);
  };

  assert(
    7,
    "a model-routed answer is byte-identical to the matcher's answer for the same intent",
    unmatched.body["kind"] === "lens" &&
      matchedFleet.body["kind"] === "lens" &&
      comparable(unmatched.body) === comparable(matchedFleet.body),
    `${String(unmatched.body["title"])} (model) vs ${String(matchedFleet.body["title"])} (matcher): ` +
      (comparable(unmatched.body) === comparable(matchedFleet.body) ? "identical" : "differ"),
  );

  const facts = {
    model: ROUTING_MODEL,
    fleetSize: AGENTS.length,
    providerRetries,
    questions: runs.length,
  };

  const failures = assertions.filter((assertion) => !assertion.passed);
  const go = failures.length === 0;

  mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
  writeFileSync(
    EVIDENCE_PATH,
    `${JSON.stringify(
      { ranAt: new Date().toISOString(), gate: "G", go, facts, assertions, runs },
      null,
      2,
    )}\n`,
  );

  console.log(`\n${assertions.length - failures.length}/${assertions.length} assertions passed`);
  console.log(`evidence: ${EVIDENCE_PATH}`);
  console.log(go ? "\nGate G: PASS" : "\nGate G: FAIL");
  if (!go) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`Gate G could not run: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
