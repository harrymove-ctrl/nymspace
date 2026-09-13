import { describe, expect, it } from "vitest";
import { BaseLlm } from "@google/adk";
import type { BaseLlmConnection, LlmRequest, LlmResponse } from "@google/adk";

import { createAdkRouter } from "./router";
import type { RouterFleet } from "./tools";

/**
 * The loop, driven by a model that does exactly what the test says.
 *
 * Gate F proves the routing stage works against a real Gemini, and that is the
 * only way to learn what a real Gemini does. What a gate cannot do is produce
 * the cases on purpose: two calls in one turn, a response that is only prose,
 * an error event, a model that never answers. Those are the branches in
 * `router.ts` that decide what the console shows, and they are reachable here
 * and nowhere else.
 *
 * Everything below runs with no credential, no network and no timing that
 * depends on a provider.
 */

class ScriptedLlm extends BaseLlm {
  constructor(private readonly script: () => AsyncGenerator<LlmResponse, void>) {
    super({ model: "scripted" });
  }

  override async *generateContentAsync(
    _request: LlmRequest,
    _stream?: boolean,
  ): AsyncGenerator<LlmResponse, void> {
    yield* this.script();
  }

  override connect(_request: LlmRequest): Promise<BaseLlmConnection> {
    throw new Error("the routing stage never opens a live connection");
  }
}

function llmThat(script: () => AsyncGenerator<LlmResponse, void>): ScriptedLlm {
  return new ScriptedLlm(script);
}

/** One turn, finished, carrying whatever parts the case needs. */
function turn(parts: LlmResponse["content"] extends undefined ? never : object[]): LlmResponse {
  return {
    content: { role: "model", parts },
    turnComplete: true,
  } as LlmResponse;
}

function callPart(name: string, args: Record<string, unknown> = {}) {
  return { functionCall: { name, args } };
}

const fleet: RouterFleet = {
  parentName: "nymspace.eth",
  agents: [
    { id: "agent-research", slug: "research", ensName: "research.nymspace.eth" },
    { id: "agent-support", slug: "support", ensName: "support.nymspace.eth" },
  ],
};

const ask = (llm: ScriptedLlm, timeoutMs = 1_000) =>
  createAdkRouter({ llm, timeoutMs }).route({ message: "anything at all", fleet });

describe("the loop", () => {
  it("takes the first call and abandons the rest of the turn", async () => {
    /*
      A model may emit several calls at once. Taking the first and stopping is
      the only option that keeps an answer to one subject — the console renders
      one lens, so a second selection could only be dropped silently or drawn
      as something nobody asked about.
    */
    const routing = await ask(
      llmThat(async function* () {
        yield turn([
          callPart("show_agent", { agentId: "agent-research" }),
          callPart("show_audit", { agentId: "agent-support" }),
        ]);
      }),
    );

    expect(routing).toMatchObject({
      kind: "call",
      tool: "show_agent",
      call: { tool: "show_agent", agentId: "agent-research" },
    });
  });

  it("skips a turn with no call and takes the one that follows", async () => {
    const routing = await ask(
      llmThat(async function* () {
        yield turn([{ text: "Let me think about which of these you mean." }]);
        yield turn([callPart("show_fleet")]);
      }),
    );

    expect(routing).toMatchObject({ kind: "call", tool: "show_fleet" });
  });

  it("returns no prose, ever", async () => {
    const routing = await ask(
      llmThat(async function* () {
        yield turn([
          { text: "research.nymspace.eth may write its own agent-context record." },
        ]);
      }),
    );

    // Fluent, plausible, and about a permission nobody read. It reaches the
    // caller as a miss and nothing else — there is no channel for it to
    // arrive on.
    expect(routing).toEqual({ kind: "miss", reason: "no_call", elapsedMs: expect.any(Number) });
    expect(JSON.stringify(routing)).not.toContain("agent-context");
  });
});

describe("failures", () => {
  it("reports an error event as a provider error, with the code and not the message", async () => {
    const routing = await ask(
      llmThat(async function* () {
        yield {
          errorCode: "429",
          errorMessage: "Quota exceeded for request: what does research's mcp serve",
        } as LlmResponse;
      }),
    );

    expect(routing).toMatchObject({ kind: "miss", reason: "provider_error", providerCode: "429" });
    // The message can quote the request that produced it, and the request here
    // is the operator's question and the fleet.
    expect(JSON.stringify(routing)).not.toContain("Quota exceeded");
  });

  it("treats STOP as the model declining rather than as an outage", async () => {
    const routing = await ask(
      llmThat(async function* () {
        yield { errorCode: "STOP" } as LlmResponse;
      }),
    );

    expect(routing).toMatchObject({ kind: "miss", reason: "no_call" });
    expect(routing).not.toHaveProperty("providerCode");
  });

  it("gives up on a model that never answers, inside the budget", async () => {
    const routing = await ask(
      llmThat(async function* () {
        await new Promise((never) => setTimeout(never, 60_000));
        yield turn([callPart("show_fleet")]);
      }),
      120,
    );

    expect(routing).toMatchObject({ kind: "miss", reason: "timeout" });
    expect(routing.elapsedMs).toBeLessThan(2_000);
  });

  it("refuses an agent the request's fleet does not contain", async () => {
    const routing = await ask(
      llmThat(async function* () {
        yield turn([callPart("show_agent", { agentId: "agent-admin" })]);
      }),
    );

    expect(routing).toMatchObject({ kind: "miss", reason: "unknown_agent" });
  });

  it("refuses a tool that does not exist", async () => {
    const routing = await ask(
      llmThat(async function* () {
        yield turn([callPart("delete_agent", { agentId: "agent-research" })]);
      }),
    );

    expect(routing).toMatchObject({ kind: "miss", reason: "unknown_tool" });
  });
});

describe("the retry", () => {
  /**
   * Measured, not assumed: `evidence/routing-models.json` records two of four
   * empty turns placing on a second ask. These pin when a second ask happens
   * at all, which is the part a measurement cannot decide.
   */
  function twoTurns(first: LlmResponse, second: LlmResponse) {
    let call = 0;
    return llmThat(async function* () {
      call += 1;
      yield call === 1 ? first : second;
    });
  }

  it("asks again after an empty turn, and takes the second answer", async () => {
    const routing = await ask(
      twoTurns(turn([{ text: "" }]), turn([callPart("show_fleet")])),
      5_000,
    );

    expect(routing).toMatchObject({ kind: "call", tool: "show_fleet" });
  });

  it("does not ask again after a provider error", async () => {
    let calls = 0;
    const llm = llmThat(async function* () {
      calls += 1;
      yield { errorCode: "429", errorMessage: "quota" } as LlmResponse;
    });

    // Asking again immediately is what a service refusing for quota least
    // needs, and the console already has a good answer for an outage.
    const routing = await createAdkRouter({ llm, timeoutMs: 5_000 }).route({
      message: "anything at all",
      fleet,
    });

    expect(routing).toMatchObject({ kind: "miss", reason: "provider_error" });
    expect(calls).toBe(1);
  });

  it("does not ask again after a timeout, and never exceeds one budget", async () => {
    let calls = 0;
    const llm = llmThat(async function* () {
      calls += 1;
      await new Promise((never) => setTimeout(never, 60_000));
      yield turn([callPart("show_fleet")]);
    });

    const started = Date.now();
    const routing = await createAdkRouter({ llm, timeoutMs: 200 }).route({
      message: "anything at all",
      fleet,
    });

    expect(routing).toMatchObject({ kind: "miss", reason: "timeout" });
    expect(calls).toBe(1);
    // The budget bounds the whole request, retry included.
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("skips the retry when the budget has nothing left to spend", async () => {
    let calls = 0;
    const llm = llmThat(async function* () {
      calls += 1;
      await new Promise((slow) => setTimeout(slow, 300));
      yield turn([{ text: "" }]);
    });

    const routing = await createAdkRouter({ llm, timeoutMs: 1_200 }).route({
      message: "anything at all",
      fleet,
    });

    // 1200 - 300 leaves under the 2s floor, so a second ask would be a request
    // that times out rather than an answer.
    expect(routing).toMatchObject({ kind: "miss", reason: "no_call" });
    expect(calls).toBe(1);
  });

  it("asks once when the caller turned the retry off", async () => {
    let calls = 0;
    const llm = llmThat(async function* () {
      calls += 1;
      yield turn([{ text: "" }]);
    });

    // `measure-routing.ts` depends on this: one call is one attempt, or the
    // numbers it pins a model on are measuring a retry it did not ask for.
    const routing = await createAdkRouter({ llm, timeoutMs: 5_000, retry: false }).route({
      message: "anything at all",
      fleet,
    });

    expect(routing).toMatchObject({ kind: "miss", reason: "no_call" });
    expect(calls).toBe(1);
  });
});
