# Design

## D1 — Two stages, and the matcher is the first one

```text
message ──▶ matcher (regex, no I/O)  ──hit──▶  lens / plan          routedBy: "matcher"
                    │
                   miss
                    ▼
              ADK routing call  ──tool call──▶  the same lens / plan  routedBy: "model"
                    │
              no tool · unknown tool · bad argument · timeout · error
                    ▼
              LensUnanswered, as today                                routedBy: "matcher"
```

Model-first was considered and rejected on three counts, in increasing order of importance.

It is slower and it costs money on every message, including the nine the demo actually types.

It is less reliable exactly where the product is least able to absorb it. `chat.test.ts` pins the cases where two intents sit one word apart — *"as research, set its mcp endpoint to …"* is a record write and *"what does research's mcp serve"* is a connect plan, and both name the agent and say `mcp`. Those pass today because the order of the branches decides them. A model deciding them passes most of the time, and the failure is a plan to write a record nobody asked to write.

And it would throw away the property that makes the chat defensible. A matcher that hits is a deterministic function of the message; putting a model in front of it means no answer in this product is reproducible any more, in exchange for handling sentences the matcher already handles.

So the model is a fallback, and `unanswered` — which exists precisely because the failure to understand is a claim about the question rather than about the fleet — is the branch it replaces.

## D2 — The model emits a tool call; it cannot emit an answer

The routing call is configured with a tool surface and no useful text channel. What comes back is a tool name and arguments, or nothing, and "nothing" is the unanswered state.

Every argument is drawn from a closed set:

```text
agent        one of the ids returned by store.listAgents(ORGANIZATION_ID), this request
recordKey    one of agentEndpointKey("mcp") | agentEndpointKey("a2a") | AGENT_CONTEXT_KEY
amount       a decimal string of whole ETH, bounded to 12 digits so wei arriving
             in an ETH field is refused; re-parsed server-side through the
             matcher's own conversion, never trusted as base units
recipient    a 0x address, checked with isAddress, defaulting as paymentPlan already defaults
label        a new agent's label, validated against the same rule POST /v1/agents applies
value        free text — the only free-text argument, and it is a record's value, which is free text
```

The agent enumeration is rebuilt from the store on each request rather than described in the prompt, so a model naming an agent that does not exist produces a miss, not a lookup for a fabricated name. This is the same move `matchAgent` already makes and the same reason it gives: a near-miss that resolves to the wrong agent answers confidently about something nobody asked about.

`value` is unconstrained because constraining it would be theatre — it is the text an operator wants written into a record, and it lands in a `LensPlan` the operator reads before confirming.

## D3 — The tools are the functions that exist, not a second implementation

Each tool is a thin adapter over the function `route()` already calls. No tool reaches the chain, the store or the provider on its own, and no tool has a code path the matcher does not also reach.

That keeps one property that is easy to lose: the eight answers are identical whether the matcher or the model selected them. A model-routed audit trail is `auditLens` — the same lanes, the same denial rows it refuses to filter out, the same `readAt`. If the tools had their own rendering, the chat would have two ways to describe a permission and would eventually disagree with itself, which is the failure `lens.ts` already names about the plan steps: *"a chat that grew its own way to grant a permission would be a second implementation of the one thing this product is about."*

It also means the write tools inherit the guarantee rather than restate it. `matchPlan`'s branches return plans; the tool wrapping them returns a plan; nothing in `chat.ts` writes, before or after this change.

## D4 — The model's prose is discarded, and that is the whole product claim

ADK will happily produce a sentence alongside a tool call. It is dropped on the floor.

The reason is the line on the page: every answer is assembled from a read performed when you ask. If one sentence of model text reached the rendered answer, that sentence would be indistinguishable from the read-derived ones beside it, and the operator's only way to tell would be to know which fields the model was allowed to touch. A model-written caption on a diagram of onchain permissions is the exact failure `chat.ts`'s header warns about — fluent, adjacent to true facts, and unfalsifiable.

So the model's contribution to the rendered answer is: which function ran, and with what argument. Nothing else crosses.

## D5 — How the answer was routed travels with the answer

`ConsoleAnswer` gains the routing stage, and the console shows it on a model-routed answer.

This is not a debug field. The product's claim to an operator is that what they are looking at was read rather than produced, and after this change that claim is true of the body and not of the selection. A console that quietly routed with a model would be relying on nobody asking which part the model did — and the answer to "which part" is the difference between a wrong diagram and a diagram of the wrong thing, which an operator can spot immediately if told that a machine picked the subject.

Cheap to render, and it makes the failure mode legible: an operator who sees a model-routed answer about the wrong agent knows to re-ask with the name.

## D6 — One turn, no transcript

The routing call gets the current message and the agent enumeration. It does not get the conversation.

This is D4 of the discovery design applied here — *the LLM gets a tool, not a transcript*. Conversation history is what turns a bounded classification into an open-ended one: it is where an injected instruction from a record value read three answers ago survives to influence the next routing decision, and it is where "as research, set X" starts meaning something different depending on what was asked before. The chat route is stateless today and stays stateless, which also keeps it horizontally scalable on Railway with no session store.

The cost is that follow-ups like *"and the audit trail?"* do not resolve. That is a real limitation, honestly worse than a chat with memory, and it is the price of every answer being independently reproducible from its own message. Revisit it only with a stated threat model for injected text.

## D7 — ADK rather than a REST call, with eyes open

`ranking.ts` deliberately speaks REST to this provider and says why: *"a dependency whose version moves is one more thing to re-verify before a demo."* That argument applies here too, and `@google/adk` is heavier than the thing it replaces — it pulls `@google/genai`, MikroORM, `google-auth-library`, the A2A SDK and the OpenTelemetry SDK for what is, at the wire level, one function-calling request.

It is still the right choice for three reasons.

The tool loop is the part that would otherwise be hand-written, and it is the part where mistakes are subtle: schema generation from the argument types, the call/result/continue cycle, the parallel-call and malformed-call cases. A hand-rolled version of that is fifty lines that work until a model returns two calls at once.

ADK's tool surface is the enforcement point D2 depends on. Declaring the closed sets as tool schemas means the constraint is checked by the runner and re-checked server-side, instead of living only in a prompt instruction that a model is free to ignore.

And it is the same vendor's agent stack as the ranking step, which keeps the story one story.

The mitigation for the dependency risk is the cut line in the proposal: the tool schema is the contract and ADK is the runner, so dropping to a direct `@google/genai` call is a swap of one module, not a redesign. Pin the version exactly, for the reason `RANKING_MODEL` is pinned.

## D8 — It lives in a guarded package, injected through `deps`

A new `server-only`-guarded workspace package holds the runner, the tool schemas and the model pin. `apps/api/src/deps.ts` constructs it and hands it to the route through `c.var.deps`, like every other provider client.

Two consequences, both from `CLAUDE.md` rather than from taste. The guard keeps `GEMINI_API_KEY` out of anything a client component can import, which is the same reason the ranking step is not in a Next route. And injection through `deps` is what lets `chat.test.ts` exercise the model path with a fake router — asserting that a given tool call renders the same lens the matcher renders — with no network, no key and no module state arranged before a hoisted import.

The route keeps deciding *whether* to call it. The package decides *what the model may do*. Neither decides what the answer says.

## D9 — The model is pinned, on measurement

The routing model is a constant in the package, not an environment variable, for the reason `RANKING_MODEL` is: a deploy that changes the model changes what the tests were written against, and a routing model that is newer and refuses to answer ranks below an older one that responds. Gate E's measurements against this provider are the starting point, not an assumption — the routing call is smaller than the ranking call and deserves its own timings before the constant is set.

## D10 — Every failure lands on the state that already exists

Missing credential, timeout, 429, 503, malformed response, unknown tool name, an argument that does not resolve to a live agent — all of them return `unanswered` with `CONSOLE_SUGGESTIONS`, and the route returns 200.

No new error surface, because there is no better answer available: the operator asked something the console could not route, which is what that state says. A 5xx here would report the provider's health as the product's, which is the same objection `/health` exists to avoid.

An empty turn gets one more ask, and nothing else does. The pinned model's
miss is a turn with no call in it, and that turn is not deterministic: two of
four placed when asked again, taking a twelve-question run from seven
placements to nine, with the retried requests finishing inside 1.6 seconds in
total. A provider error does not retry — asking again immediately is what a
service refusing for quota least needs — and a timeout does not retry, because
the budget exists to bound the longest wait and doubling it for the slowest
case is the opposite of what it is for. Both attempts share one budget, so a
retry can never push a request past what a single call was allowed, and a
second ask is skipped entirely when what remains is too little to answer in.

The timeout is a hard budget. It was written down here as "below the point where a person watching a demo assumes the page is broken", and the measurement moved it: ten seconds, from a worst observed call of nine. That is longer than the original intent and it is the right trade, for the reason running the matcher first makes available — the nine demo sentences never wait on a provider at all, so the budget is only ever spent on a question that would otherwise have been refused outright.

## D11 — Agent-supplied text is data, in the user turn

The system instruction is fixed text naming the tools and the rules. Agent labels, ENS names, record values and the live agent enumeration go into the user turn as JSON data, explicitly marked as untrusted.

This is `agent-discovery`'s existing requirement — *registration descriptions and endpoint metadata MUST enter as data and MUST NOT be inserted into system instructions or used to expand the model's tool authority* — and it binds here for a sharper reason: discovery's model orders a list, and this one selects an action. The blast radius of a successful injection is bounded by D2 to *the wrong read*, and reads are recoverable. The line that must hold is that no injected text can reach a write, and it holds because there is no write tool — only plan tools, and a plan is an offer.

## D12 — What the page may claim afterwards

The current copy is *"Nothing is generated, so nothing is guessed."* After this change the first half stays true of every answer body and the second half is false of the routing, so the copy changes.

The rule it has to satisfy is the one `docs/08` states about approval paths and `agent-console` states about self-reported identity: claim the weaker true thing. The replacement says that answers are assembled from live reads, and that a question the console cannot match directly is routed by a model choosing which read to perform — not that the console understands English, and not that nothing is generated.

## Open questions

**OQ1 — Does `@google/adk` run cleanly in the API process? Closed: yes.**
`@google/adk@2.0.0` imports under `node --conditions=react-server` in about
250 ms, with no database driver and no telemetry exporter constructed at module
scope. `Gemini`, `LlmAgent`, `FunctionTool`, `InMemoryRunner` and
`getFunctionCalls` are all on the root export, and `runner.runEphemeral` is the
one-turn, no-session call D6 asks for. 159 packages, installed in seconds. The
cut line stays written down, unexercised.

**OQ2 — Which credential. Closed: `GEMINI_API_KEY`, and it is passed
explicitly.** ADK's `Gemini` model takes `apiKey` as a constructor parameter
and otherwise looks for `GOOGLE_GENAI_API_KEY`, `GOOGLE_API_KEY` and
`GEMINI_API_KEY` in that order. `deps.ts` reads `GEMINI_API_KEY` — already in
`turbo.json` and `.env.example`, so `pnpm env:check` needed no new variable —
and hands it to `createAdkRouter`, so a keyless deployment resolves to no
router where every other credential resolves, rather than inside a provider
call on a request.

**OQ3 — Which model, and at what timeout. Closed: `gemini-3.5-flash-lite` at
ten seconds.** The table is in `packages/adk/src/model.ts` and the runs in
`packages/adk/evidence/routing-models.json`. The choice turns on the shape of
the failures rather than the count: `gemini-3.1-flash-lite` answered every
attempt and sent half of them to the wrong agent, `gemini-3.6-flash` was right
whenever it answered and spent four of ten attempts on 429s, and the pinned
model misses by producing an empty turn — which lands on the unanswered state
that already exists. Seven placements in ten, against ten refusals in ten
before this stage existed.

The timeout has its own lesson, and it is why this entry says *re-measure*.
The first measurement run reported a 720ms median for the pinned model; a
four-second budget derived from it timed out five of seven live calls in the
next Gate F run, and two assertions then "passed" because a timeout is also a
miss. A later run of the same two questions on the same key put the median at
6.7s and the worst call at 9.0s; the run after that came back between 0.8s and
1.5s. This provider's latency moves by an order of magnitude within an hour, so
the budget is set from the worst observed call and never from the median.

**OQ4 — Does a model-routed answer need its own tone in the console?** D5 requires disclosure, not a particular treatment. Whether that is a pill beside the title, a line in the caption, or something the design register already has is the console's decision, and `console-design-system` owns it. What it must not be is absent, and it must not look like a verification badge.
