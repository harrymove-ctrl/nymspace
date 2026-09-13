import type { Schema } from "@google/genai";

/**
 * The tool surface the console chat's routing stage may use, and the closed
 * sets its arguments are drawn from.
 *
 * This module is the contract and nothing else. It builds no answer, performs
 * no read and holds no credential: it declares eight tools, validates what a
 * model said about them, and hands back a value `apps/api` dispatches to the
 * lens builders it already has.
 *
 * Two properties are the whole point, and both come from
 * `openspec/changes/route-the-console-chat-with-adk/design.md` D2.
 *
 * **The model selects; it never names.** Agent arguments are an enumeration
 * built from `store.listAgents` on the request being answered, declared to the
 * model as a schema `enum` rather than described in prose. A model that wants
 * an agent picks one that exists, and a model that invents one produces a
 * validation miss instead of a lookup for a name nobody registered. That is
 * `matchAgent`'s own rule — a near-miss resolving to the wrong agent answers
 * confidently about something nobody asked about — enforced one layer earlier.
 *
 * **No argument arrives in a unit the server would have to trust.** An amount
 * is a decimal string of whole ETH and is re-parsed into wei by the caller,
 * through the same function the matcher uses. Base units never cross this
 * boundary; see `ChatToolCall`'s `plan_payment`.
 */

/**
 * The record keys this product defines, as the words an operator uses.
 *
 * The model chooses one of three names. `apps/api` maps the name onto the
 * real ENS key with `agentEndpointKey`/`AGENT_CONTEXT_KEY`, so the opaque
 * `agent-registration[0x…]` form never has to be reproduced by a model, and a
 * key this product does not define cannot be expressed at all.
 */
export const RECORD_KEY_NAMES = ["mcp", "a2a", "agent-context"] as const;
export type RecordKeyName = (typeof RECORD_KEY_NAMES)[number];

/**
 * How many agents the model may be asked to choose between.
 *
 * `store.listAgents` has no `LIMIT`, and every agent it returns appears twice
 * in a request: once in the schema `enum` of each agent-scoped tool, and once
 * in the fleet JSON of the user turn. Left unbounded, an organization with a
 * few hundred agents sends six copies of a few hundred strings on a call
 * already budgeted at ten seconds against a provider whose measured latency
 * reaches nine — so the routing stage would get slower exactly as the fleet
 * got large enough to need it.
 *
 * Fifty is a window, not a wall. The matcher reads the whole store and is
 * unaffected, so an agent outside the window is still reachable by typing its
 * name — which is what the operator does anyway once a fleet is that size.
 * The window is the first fifty in the order the store returned, which is by
 * slug, so it is the same window on every request rather than whatever the
 * database felt like returning first.
 */
export const ROUTABLE_FLEET_LIMIT = 50;

/**
 * The agents one request may route to.
 *
 * One function, because the schema and the prompt have to agree. If the enum
 * held fifty and the user turn listed three hundred, the model would name an
 * agent it was shown and the validator would reject it — a miss that looks
 * like the model misbehaving and is the caller disagreeing with itself.
 */
export function routableAgents(fleet: RouterFleet): FleetAgent[] {
  return fleet.agents.slice(0, ROUTABLE_FLEET_LIMIT);
}

/** One agent, as the routing stage is allowed to see it. */
export interface FleetAgent {
  id: string;
  slug: string;
  ensName: string;
}

/**
 * What the model may choose from, rebuilt per request.
 *
 * Passed in rather than read here, because this package holds no store handle
 * — `apps/api` owns the reads and this owns the constraint.
 */
export interface RouterFleet {
  agents: FleetAgent[];
  /** The parent ENS name, so an onboarding label can be shown in context. */
  parentName: string;
}

/**
 * A validated selection: which read to perform, and with what.
 *
 * Every member maps to a function `apps/api/src/routes/chat.ts` already calls
 * on the matcher's path. There is no member that writes, which is why an
 * injected instruction reaching the model cannot reach a transaction — the
 * strongest thing in this union is a plan, and a plan is an offer.
 */
export type ChatToolCall =
  | { tool: "show_fleet" }
  | { tool: "show_agent"; agentId: string }
  | { tool: "show_audit"; agentId: string }
  | { tool: "plan_onboard"; label: string }
  | { tool: "plan_grant"; agentId: string; recordKey: RecordKeyName }
  | {
      tool: "plan_record_write";
      agentId: string;
      recordKey: RecordKeyName;
      value?: string;
    }
  | {
      tool: "plan_payment";
      agentId: string;
      /** Whole ETH as a decimal string. Never base units — see D2. */
      amountEth: string;
      recipient?: string;
    }
  | { tool: "plan_connect"; agentId: string };

export type ChatToolName = ChatToolCall["tool"];

/**
 * A label for a new agent: the same shape `POST /v1/agents` accepts.
 *
 * Validated here as well as there because an onboarding plan prints the name
 * it would register, and a plan showing `Support Agent!.nym.eth` is a plan the
 * operator would confirm and the API would then refuse.
 */
const LABEL = /^[a-z0-9][a-z0-9-]{1,30}$/;

/** A decimal amount of whole ETH. Bounded so a plan cannot print 400 digits. */
const AMOUNT = /^\d{1,12}(\.\d{1,18})?$/;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * The tool declarations for one request.
 *
 * Built per call rather than once at module scope, because the agent
 * enumeration is the constraint and the fleet changes. A stale enum would let
 * a model select an offboarded agent, which is the sort of bug that only
 * appears after a demo has been running for a day.
 *
 * With an empty fleet the six agent-scoped tools are not declared at all. The
 * tool surface narrows to what is answerable, rather than offering a model the
 * chance to pass an id from nowhere.
 */
export function chatToolDeclarations(fleet: RouterFleet): {
  name: ChatToolName;
  description: string;
  parameters: Schema;
}[] {
  const ids = routableAgents(fleet).map((agent) => agent.id);

  const agentParam: Schema = {
    type: "STRING",
    description: "The id of the agent, from the fleet listed in the message.",
    enum: ids,
  } as Schema;

  const recordKeyParam: Schema = {
    type: "STRING",
    description:
      "Which record: the MCP endpoint, the A2A endpoint, or the agent's context description.",
    enum: [...RECORD_KEY_NAMES],
  } as Schema;

  const object = (
    properties: Record<string, Schema>,
    required: string[],
  ): Schema => ({ type: "OBJECT", properties, required }) as Schema;

  const declarations: {
    name: ChatToolName;
    description: string;
    parameters: Schema;
    needsFleet: boolean;
  }[] = [
    {
      name: "show_fleet",
      description:
        "Show every agent in the organization against ENS, the ERC 8004 registry and ENSIP 25 verification. Use for any question about the fleet as a whole, what agents exist, or what the organization has deployed.",
      parameters: object({}, []),
      needsFleet: false,
    },
    {
      name: "show_agent",
      description:
        "Show one agent's identity, its onchain permissions and its records, read live. Use for any question about a single agent: who it is, what it may write, whether it verifies, what it has set.",
      parameters: object({ agentId: agentParam }, ["agentId"]),
      needsFleet: true,
    },
    {
      name: "show_audit",
      description:
        "Show one agent's lifecycle from the activity log, oldest first, including every denial. Use for questions about history, what happened, or what was refused.",
      parameters: object({ agentId: agentParam }, ["agentId"]),
      needsFleet: true,
    },
    {
      name: "plan_onboard",
      description:
        "Produce a plan to register a new agent subname under the organization's parent name. Proposes the work; does not perform it.",
      parameters: object(
        {
          label: {
            type: "STRING",
            description:
              "The new agent's label, lowercase letters, digits and hyphens — the part before the parent name.",
          } as Schema,
        },
        ["label"],
      ),
      needsFleet: false,
    },
    {
      name: "plan_grant",
      description:
        "Produce a plan for the organization to authorize an agent's controller to write one record key. Proposes the work; does not perform it.",
      parameters: object({ agentId: agentParam, recordKey: recordKeyParam }, [
        "agentId",
        "recordKey",
      ]),
      needsFleet: true,
    },
    {
      name: "plan_record_write",
      description:
        "Produce a plan for an agent's controller to write one of its own records. Proposes the work; does not perform it. Use when the operator speaks as the agent, for example 'as research, set its mcp endpoint to …'.",
      parameters: object(
        {
          agentId: agentParam,
          recordKey: recordKeyParam,
          value: {
            type: "STRING",
            description: "The value to write, if the operator gave one.",
          } as Schema,
        },
        ["agentId", "recordKey"],
      ),
      needsFleet: true,
    },
    {
      name: "plan_payment",
      description:
        "Produce a plan to preview and then send a payment from an agent's wallet, against its spend policy. Proposes the work; does not perform it.",
      parameters: object(
        {
          agentId: agentParam,
          amountEth: {
            type: "STRING",
            description:
              "The amount in whole ETH as a decimal string, for example '0.0001'. Never in wei.",
          } as Schema,
          recipient: {
            type: "STRING",
            description:
              "A 0x recipient address, if the operator named one. Omit to pay the agent's controller.",
          } as Schema,
        },
        ["agentId", "amountEth"],
      ),
      needsFleet: true,
    },
    {
      name: "plan_connect",
      description:
        "Produce a plan to handshake with an agent's MCP endpoint and list the tools it serves. Proposes the work; performs no outbound request. Use for questions about what an agent's MCP server offers or whether it is reachable.",
      parameters: object({ agentId: agentParam }, ["agentId"]),
      needsFleet: true,
    },
  ];

  return declarations
    .filter((declaration) => !declaration.needsFleet || ids.length > 0)
    .map(({ needsFleet: _needsFleet, ...declaration }) => declaration);
}

/** Why a selection was not usable. Carried so the log can say which. */
export type ToolCallRejection =
  | "unknown_tool"
  | "unknown_agent"
  | "unknown_record_key"
  | "bad_label"
  | "bad_amount"
  | "bad_recipient";

export type ToolCallResult =
  | { ok: true; call: ChatToolCall }
  | { ok: false; rejection: ToolCallRejection };

/**
 * Check what the model said against the sets it was given.
 *
 * The schema already declares the enums, and this checks them again. Not
 * belt-and-braces for its own sake: a schema constrains what a model is asked
 * for, and nothing in the protocol makes it impossible for a response to
 * arrive with something else in it. The set that decides is the one built from
 * this request's reads, and it is checked here, where the answer is still a
 * value rather than a rendered plan.
 */
export function validateToolCall(
  name: string,
  args: Record<string, unknown>,
  fleet: RouterFleet,
): ToolCallResult {
  /**
   * Checked against the window the model was shown, not against the whole
   * fleet.
   *
   * The two differ once an organization passes {@link ROUTABLE_FLEET_LIMIT},
   * and validating against the wider set would accept an id the schema never
   * offered — a value that could only have come from somewhere other than the
   * enum. `routableAgents` is the one definition of what this request may
   * select, and the schema, the prompt and this check all read it.
   */
  const routable = routableAgents(fleet);

  const agentId = (): string | undefined => {
    const value = args.agentId;
    if (typeof value !== "string") return undefined;
    return routable.some((agent) => agent.id === value) ? value : undefined;
  };

  const recordKey = (): RecordKeyName | undefined => {
    const value = args.recordKey;
    return typeof value === "string" &&
      (RECORD_KEY_NAMES as readonly string[]).includes(value)
      ? (value as RecordKeyName)
      : undefined;
  };

  const optionalString = (key: string): string | undefined => {
    const value = args[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };

  switch (name) {
    case "show_fleet":
      return { ok: true, call: { tool: "show_fleet" } };

    case "show_agent":
    case "show_audit":
    case "plan_connect": {
      const id = agentId();
      if (!id) return { ok: false, rejection: "unknown_agent" };
      return { ok: true, call: { tool: name, agentId: id } };
    }

    case "plan_onboard": {
      const label = optionalString("label");
      if (!label || !LABEL.test(label)) {
        return { ok: false, rejection: "bad_label" };
      }
      return { ok: true, call: { tool: "plan_onboard", label } };
    }

    case "plan_grant": {
      const id = agentId();
      if (!id) return { ok: false, rejection: "unknown_agent" };
      const key = recordKey();
      if (!key) return { ok: false, rejection: "unknown_record_key" };
      return { ok: true, call: { tool: "plan_grant", agentId: id, recordKey: key } };
    }

    case "plan_record_write": {
      const id = agentId();
      if (!id) return { ok: false, rejection: "unknown_agent" };
      const key = recordKey();
      if (!key) return { ok: false, rejection: "unknown_record_key" };
      return {
        ok: true,
        call: {
          tool: "plan_record_write",
          agentId: id,
          recordKey: key,
          /**
           * The one unconstrained argument, and deliberately so. It is the
           * text an operator wants written into a record, which is free text
           * by definition, and it lands in a plan the operator reads before
           * confirming. Constraining it would be theatre.
           */
          value: optionalString("value"),
        },
      };
    }

    case "plan_payment": {
      const id = agentId();
      if (!id) return { ok: false, rejection: "unknown_agent" };
      const amountEth = optionalString("amountEth");
      if (!amountEth || !AMOUNT.test(amountEth)) {
        return { ok: false, rejection: "bad_amount" };
      }
      const recipient = optionalString("recipient");
      if (recipient !== undefined && !ADDRESS.test(recipient)) {
        return { ok: false, rejection: "bad_recipient" };
      }
      return {
        ok: true,
        call: { tool: "plan_payment", agentId: id, amountEth, recipient },
      };
    }

    default:
      return { ok: false, rejection: "unknown_tool" };
  }
}
