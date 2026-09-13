import { describe, expect, it } from "vitest";
import { CONSOLE_SUGGESTIONS } from "@nymspace/core";
import type { ChatRouter, ChatRouting, RouterRequest } from "@nymspace/adk";
import { createApp } from "../app";
import type { Deps } from "../deps";

/**
 * The chat's matcher, pinned where its order matters.
 *
 * Intents are regexes tried in sequence, and several questions name the same
 * agent and the same word. "what does research's mcp serve", "as research,
 * set its mcp endpoint to …" and "show research" differ only in which rule
 * reaches them first — so a reorder that answered one with another's plan
 * would compile and serve, and nothing but these tests would notice.
 */

const agent = {
  id: "agent-research",
  organizationId: "nymspace",
  slug: "research",
  ensName: "research.nymspace.eth",
  controllerAddress: "0xDEA25D2537cE06cE1073dd9621C70056CBDC3aEB",
  provisioning: {
    ens: "active",
    erc8004: "registered",
    ensip25: "verified",
    graph: "indexed",
    financial: "policy_configured",
  },
};

const ADDRESS = "0x0000000000000000000000000000000000000001";

/**
 * An ENS service that answers every read with nothing and records what it
 * was asked, so a test can say "the chat touched no chain" and mean it.
 */
function recordingEns(calls: string[]) {
  return new Proxy(
    {},
    {
      get(_, key) {
        return async () => {
          calls.push(String(key));
          if (key === "canSetText") return false;
          if (key === "findOwner" || key === "getResolver") return ADDRESS;
          return "";
        };
      },
    },
  ) as unknown as Deps["ens"];
}

/**
/**
 * A router that answers with whatever the test decided, and records what it
 * was asked.
 *
 * The routing stage is a seam rather than a class for exactly this: the model
 * path is exercised with no credential, no network and no timing, and what is
 * asserted is the part that is ours — which read a selection runs, what the
 * answer says about being routed, and what the router was allowed to see.
 */
function fakeRouter(routing: ChatRouting, seen: RouterRequest[] = []): ChatRouter {
  return {
    async route(request) {
      seen.push(request);
      return routing;
    },
  };
}

/**
 * The wallet reference the fixture's agent carries, matching its own
 * `financial: "policy_configured"`. A payment plan is only offered when one
 * exists, so a store that answered `undefined` here would describe an agent
 * whose provisioning state and whose authority disagreed.
 */
const AUTHORITY = {
  agentId: agent.id,
  privyWalletId: "wallet-research",
  walletAddress: ADDRESS,
  policyId: "policy-research",
  policyLabel: "research spend limit",
};

function chatApp(
  calls: string[] = [],
  // `null`, not `undefined`: an explicit `undefined` argument selects the
  // default parameter, which would silently give the no-wallet test a wallet.
  authority: (Omit<typeof AUTHORITY, "policyId"> & { policyId?: string }) | null =
    AUTHORITY,
  chatRouter?: ChatRouter,
) {
  const deps = {
    chatRouter,
    store: {
      listAgents: async () => [agent],
      getAgent: async (id: string) => (id === agent.id ? agent : undefined),
      // The audit suggestion reads the log; an empty one is a valid trail.
      listActivity: async () => [],
      getFinancialAuthority: async () => authority ?? undefined,
    },
    ens: recordingEns(calls),
    config: { chainId: 11155111 },
    registry: ADDRESS,
    organization: ADDRESS,
    controller: agent.controllerAddress,
    parentName: "nymspace.eth",
  } as unknown as Deps;
  return createApp({ port: 0, allowedOrigins: [] }, deps);
}

async function ask(
  message: string,
  calls: string[] = [],
  chatRouter?: ChatRouter,
  authority: Parameters<typeof chatApp>[1] = AUTHORITY,
) {
  const res = await chatApp(calls, authority, chatRouter).fetch(
    new Request("http://api.test/v1/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    }),
  );
  expect(res.status, message).toBe(200);
  return res.json();
}

describe("the MCP intent", () => {
  it("answers with an unsigned connect plan and performs no connect", async () => {
    const calls: string[] = [];
    const answer = await ask("what does research's mcp serve", calls);

    expect(answer).toMatchObject({
      kind: "plan",
      steps: [
        {
          method: "POST",
          path: "/v1/mcp/connect",
          body: { target: { kind: "fleet", agentId: "agent-research" } },
          actor: "none",
        },
      ],
    });
    expect(answer.steps).toHaveLength(1);
    // No ENS read: the endpoint is not even resolved until the plan is run.
    expect(calls).toEqual([]);
  });

  it("recognises the other ways the question is asked", async () => {
    for (const message of [
      "is research's mcp up",
      "what tools does research's mcp offer",
      "connect to research.nymspace.eth mcp",
    ]) {
      const answer = await ask(message);
      expect(answer.kind, message).toBe("plan");
      expect(answer.steps[0].path, message).toBe("/v1/mcp/connect");
    }
  });
});

describe("the questions it must not steal", () => {
  it("keeps an endpoint write a record-write plan", async () => {
    const answer = await ask("as research, set its mcp endpoint to https://example.com/mcp");
    expect(answer.kind).toBe("plan");
    expect(answer.steps[0].path).toBe("/v1/agents/agent-research/records");
    expect(answer.steps[0].actor).toBe("controller");
  });

  it("keeps a plain question about the agent the agent lens", async () => {
    const answer = await ask("show research");
    expect(answer.kind).toBe("lens");
    expect(answer.title).toBe("research.nymspace.eth");
  });
});

describe("the payment intent", () => {
  it("offers the two-step plan when the agent holds a wallet under a policy", async () => {
    const answer = await ask("pay 0.0001 ETH from research to research");

    expect(answer.kind).toBe("plan");
    expect(answer.steps.map((step: { path: string }) => step.path)).toEqual([
      "/v1/agents/agent-research/payments/preview",
      "/v1/agents/agent-research/payments",
    ]);
  });

  /**
   * The failure this pins: both steps 409 on the same missing reference, so an
   * unprovisioned agent used to get a plan promising a policy check and a
   * payment, then two identical red failures telling the operator to run a
   * `pnpm` script they have no checkout for.
   */
  it("offers no plan at all when the agent has no wallet", async () => {
    const res = await chatApp([], null).fetch(
      new Request("http://api.test/v1/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "pay 0.0001 ETH from research to research" }),
      }),
    );
    expect(res.status).toBe(200);
    const answer = await res.json();

    expect(answer.kind).toBe("unanswered");
    expect(answer.message).toContain("no wallet");
    // Not a denial: there is no policy here to refuse anything.
    expect(answer.message).not.toContain("denied");
    // And no instruction the reader cannot act on.
    expect(answer.message).not.toContain("pnpm");
  });

  it("offers no plan when the wallet carries no policy to be capped by", async () => {
    const res = await chatApp([], { ...AUTHORITY, policyId: undefined }).fetch(
      new Request("http://api.test/v1/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "pay 0.0001 ETH from research to research" }),
      }),
    );
    const answer = await res.json();

    expect(answer.kind).toBe("unanswered");
    expect(answer.message).toContain("no spend policy");
  });
});

describe("the suggestions", () => {
  it("offers only questions the matcher answers", async () => {
    // A suggestion the chat then refuses is worse than no suggestion (lens.ts).
    for (const suggestion of CONSOLE_SUGGESTIONS) {
      const answer = await ask(suggestion);
      expect(answer.kind, suggestion).not.toBe("unanswered");
    }
  });
});

describe("the routing stage", () => {
  /**
   * The sentence that prompted all of this: a real question, typed into the
   * deployed console, that the matcher returned `unanswered` for. It names no
   * agent and none of the verbs, so nothing but a router reaches an intent.
   */
  const UNMATCHED =
    "For the ENS tracks we ideally want to see projects that utilize ENS features in a meaningful and creative way. From your description it seems you're mostly using subnames currently?";

  const call = (routing: Extract<ChatRouting, { kind: "call" }>["call"]): ChatRouting => ({
    kind: "call",
    tool: routing.tool,
    call: routing,
    elapsedMs: 12,
  });

  it("answers a question the matcher could not place", async () => {
    const answer = await ask(UNMATCHED, [], fakeRouter(call({ tool: "show_fleet" })));

    expect(answer.kind).toBe("lens");
    expect(answer.routedBy).toBe("model");
  });

  it("is not consulted for a question the matcher answers", async () => {
    const seen: RouterRequest[] = [];
    const answer = await ask(
      "show research",
      [],
      fakeRouter(call({ tool: "show_fleet" }), seen),
    );

    // The nine demo sentences must never wait on a provider, and must never
    // be decided by one: `chat.test.ts` above pins which of them beat which.
    expect(seen).toEqual([]);
    expect(answer.kind).toBe("lens");
    expect(answer.title).toBe("research.nymspace.eth");
    expect(answer.routedBy).toBe("matcher");
  });

  it("shows the router the fleet and nothing else about it", async () => {
    const seen: RouterRequest[] = [];
    await ask(UNMATCHED, [], fakeRouter(call({ tool: "show_fleet" }), seen));

    // Ids, slugs and names — the fields `matchAgent` matches on. No controller
    // address, no provisioning state, no records: the router selects a read
    // and has no use for what the read would return.
    expect(seen[0]?.fleet.agents).toEqual([
      {
        id: "agent-research",
        slug: "research",
        ensName: "research.nymspace.eth",
      },
    ]);
  });

  it("answers a routed write with a plan, and performs none of it", async () => {
    /**
     * Deliberately a sentence with no slug and none of the matcher's verbs.
     * "can research send …" would name an agent, and the matcher would answer
     * it — which is the right behaviour and the wrong test.
     */
    const answer = await ask(
      "would it be possible to move a small amount to whoever owns the first one",
      [],
      fakeRouter(
        call({ tool: "plan_payment", agentId: "agent-research", amountEth: "0.0001" }),
      ),
    );

    expect(answer.kind).toBe("plan");
    expect(answer.routedBy).toBe("model");
    expect(answer.steps.map((step: { path: string }) => step.path)).toEqual([
      "/v1/agents/agent-research/payments/preview",
      "/v1/agents/agent-research/payments",
    ]);
    // Whole ETH in, base units out, through the matcher's own conversion.
    expect(answer.steps[0].body.amount).toBe("100000000000000");
  });

  it("re-checks the agent against the store, not just against the fleet", async () => {
    // The router validated against the fleet it was handed; this is the second
    // check, which is about the row still being there when the read happens.
    const answer = await ask(
      "what about the finance one",
      [],
      fakeRouter(call({ tool: "show_agent", agentId: "agent-finance" })),
    );

    expect(answer.kind).toBe("unanswered");
  });

  it("leaves a miss with the matcher's own answer", async () => {
    for (const reason of ["timeout", "provider_error", "no_call", "unknown_tool"] as const) {
      const answer = await ask(
        UNMATCHED,
        [],
        fakeRouter({ kind: "miss", reason, elapsedMs: 6000 }),
      );

      expect(answer.kind, reason).toBe("unanswered");
      expect(answer.suggestions, reason).toEqual([...CONSOLE_SUGGESTIONS]);
      // Nothing was routed, so nothing claims to have been.
      expect(answer.routedBy, reason).toBe("matcher");
    }
  });

  it("behaves exactly as before when no router is configured", async () => {
    const answer = await ask(UNMATCHED);

    expect(answer.kind).toBe("unanswered");
    expect(answer.routedBy).toBe("matcher");
  });
});

describe("the log", () => {
  /**
   * One "chat answered" per request.
   *
   * A selection that dispatched to nothing used to log the line and then let
   * the handler log it again, so a single request id carried two answers and
   * disagreed with itself about which stage produced one. A log nobody can
   * count is the failure `log.ts` exists to avoid.
   */
  it("records a request once, even when the selection dispatched to nothing", async () => {
    const lines: string[] = [];
    const app = createApp(
      { port: 0, allowedOrigins: [] },
      {
        chatRouter: fakeRouter({
          kind: "call",
          tool: "plan_connect",
          // In the fleet the router was handed, gone from the store by the
          // time the read runs.
          call: { tool: "plan_connect", agentId: "agent-ghost" },
          elapsedMs: 9,
        }),
        store: {
          listAgents: async () => [agent],
          getAgent: async (id: string) => (id === agent.id ? agent : undefined),
          listActivity: async () => [],
          getFinancialAuthority: async () => AUTHORITY,
        },
        ens: recordingEns([]),
        config: { chainId: 11155111 },
        registry: ADDRESS,
        organization: ADDRESS,
        controller: agent.controllerAddress,
        parentName: "nymspace.eth",
      } as unknown as Deps,
      (line) => lines.push(line),
    );

    const res = await app.fetch(
      new Request("http://api.test/v1/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "tell me about the one that is gone" }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.kind).toBe("unanswered");

    const answered = lines.filter((line) => line.includes('"chat answered"'));
    expect(answered).toHaveLength(1);
    expect(answered[0]).toContain('"stage":"none"');
    // The model's part is still recorded, as an unrouted request.
    expect(lines.filter((line) => line.includes('"chat unrouted"'))).toHaveLength(1);
  });
});

describe("clearing a record", () => {
  it("reads as a plan to clear, not a plan to publish a placeholder", async () => {
    const answer = await ask(
      "take the endpoint off that one entirely",
      [],
      fakeRouter({
        kind: "call",
        tool: "plan_record_write",
        call: {
          tool: "plan_record_write",
          agentId: "agent-research",
          recordKey: "mcp",
          value: "",
        },
        elapsedMs: 11,
      }),
    );

    expect(answer.kind).toBe("plan");
    expect(answer.title).toMatch(/^Clear /);
    // The value that reaches the route is the empty one, not example.com.
    expect(answer.steps[0].body.value).toBe("");
  });
});
