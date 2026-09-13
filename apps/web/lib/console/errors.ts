/**
 * The error taxonomy from `docs/03_UX_SPEC.md`.
 *
 * Four categories, and the point of separating them is that two are not errors
 * at all. "Blocked by identity policy" and "Blocked by financial policy" are
 * the control plane working — the product's central proof — and rendering them
 * in the same red box as an RPC timeout would tell the operator the system
 * broke at the exact moment it worked.
 *
 * So `tone` is not decoration. `proof` means a control refused something and
 * that is the intended outcome; `fault` means something is wrong; `waiting`
 * means somebody else has not finished.
 */

export type ErrorKind =
  | "identity_policy"
  | "financial_policy"
  | "not_configured"
  | "api_unreachable"
  | "api_error"
  | "rpc_unavailable"
  | "indexing_pending"
  | "provider_error"
  | "unknown";

export interface ConsoleError {
  kind: ErrorKind;
  /** The headline, in the words `docs/03` specifies. */
  title: string;
  detail: string;
  tone: "proof" | "fault" | "waiting";
  /** What the operator can do, when there is anything. */
  action?: string;
}

export const ERROR_COPY: Record<ErrorKind, Omit<ConsoleError, "detail">> = {
  identity_policy: {
    kind: "identity_policy",
    title: "Blocked by identity policy",
    tone: "proof",
    action: "This is the ENSv2 resolver refusing an unauthorized write.",
  },
  financial_policy: {
    kind: "financial_policy",
    title: "Blocked by financial policy",
    tone: "proof",
    action: "No funds moved. The payment never reached a chain.",
  },
  /**
   * No signing key, which is not the resolver saying no.
   *
   * `describeDenial` wraps every failed write, including one that never
   * reached a chain because the client was built read-only, and stamps
   * `source: "ensv2"` on both. Without this kind a missing environment
   * variable renders as "Something failed" at best and as the control plane
   * refusing the operator at worst — opposite facts about an agent's
   * authority, confused at an approval gate, which is where it costs the most.
   */
  not_configured: {
    kind: "not_configured",
    title: "Writes are not configured on this deployment",
    tone: "waiting",
    action:
      "Nothing was sent and nothing was refused. Set the signing key to enable writes.",
  },
  /**
   * The console's own API did not answer — not a chain, not a policy.
   *
   * It would have been less code to fold this into `rpc_unavailable`, and that
   * is exactly the mistake `classify` warns about one case further down: an RPC
   * fault and a denial are different facts and must not share a box. So are an
   * unreachable API and an unreachable Sepolia. "Sepolia RPC unavailable" shown
   * because `apps/api` is not running sends the operator to a chain explorer to
   * debug a process on their own machine, and — worse in production — implies
   * the network is down when the network is fine.
   */
  api_unreachable: {
    kind: "api_unreachable",
    title: "The console API did not answer",
    tone: "fault",
    action:
      "Nothing was read and nothing was written. The console reads every screen from the API, so this is the API or the network in front of it, not the chain.",
  },
  /**
   * The API answered, and what it answered with was a fault of its own.
   *
   * Split from `api_unreachable` because the operator's next move is the
   * opposite one: unreachable means start the process, this means the process
   * is running and its log has the reason. Collapsing the two into "Something
   * failed" — which is what this rendered as before — sends someone to check
   * whether a server they are already talking to is switched on.
   */
  api_error: {
    kind: "api_error",
    title: "The console API failed",
    tone: "fault",
    action:
      "The API answered with a server error, so the fault is behind it — its own log carries the reason and the request id.",
  },
  rpc_unavailable: {
    kind: "rpc_unavailable",
    title: "Sepolia RPC unavailable",
    tone: "fault",
    action: "Retry. Nothing about the agent has been established either way.",
  },
  indexing_pending: {
    kind: "indexing_pending",
    title: "ERC 8004 registration exists but is not indexed yet",
    tone: "waiting",
    action: "The registration transaction is the evidence until the index catches up.",
  },
  provider_error: {
    kind: "provider_error",
    title: "Discovery provider unavailable",
    tone: "fault",
    action: "This is not an empty market — the query never reached the subgraph.",
  },
  unknown: {
    kind: "unknown",
    title: "Something failed",
    tone: "fault",
  },
};

/**
 * Classify an API outcome.
 *
 * Keys on the structured fields the API already returns rather than on message
 * text: the API decodes the revert and names the policy, so re-deriving that
 * here from a string would be a second classifier free to disagree with the
 * first.
 */
export function classify(outcome: {
  status?: string;
  source?: string;
  reason?: string;
  detail?: string;
  error?: string;
}): ConsoleError {
  /**
   * `detail` first, because `reason` is a code and `detail` is the sentence.
   *
   * `describeDenial` returns both: `reason` names the error class — "NoSignerError",
   * "EACUnauthorizedAccountRoles" — and `detail` carries the message, which for a
   * configuration fault is the only place the variable to set appears. Preferring
   * the code showed the operator a class name and no remedy. Callers that pass
   * neither fall through to `error` exactly as before.
   */
  const detail = outcome.detail ?? outcome.reason ?? outcome.error ?? "";

  if (outcome.status === "denied" && outcome.source === "ensv2") {
    return { ...ERROR_COPY.identity_policy, detail };
  }
  if (outcome.status === "denied") {
    return { ...ERROR_COPY.financial_policy, detail };
  }
  if (outcome.status === "indexing_pending") {
    return { ...ERROR_COPY.indexing_pending, detail };
  }
  /**
   * The API's own word for it, not a search of its prose.
   *
   * This was a regex over the sentence `NoSignerError` happens to carry —
   * which meant rewording that message in `packages/ens` would have silently
   * regressed the classification with nothing failing to compile, and the bare
   * substring "read-only" also matches RPC failover text, so an outage could
   * be reported as a configuration problem. `describeDenial` now detects the
   * error by class and says so in `status`.
   */
  if (outcome.status === "not_configured") {
    return { ...ERROR_COPY.not_configured, detail };
  }
  if (/rpc|timed out|ECONN|unreachable/i.test(detail)) {
    // An RPC fault must never be shown as a denial: one says the agent is not
    // allowed, the other says we could not ask.
    return { ...ERROR_COPY.rpc_unavailable, detail };
  }
  if (/subgraph|provider|indexer/i.test(detail)) {
    return { ...ERROR_COPY.provider_error, detail };
  }
  return { ...ERROR_COPY.unknown, detail };
}

/**
 * Classify something that was *thrown*, as opposed to an outcome body.
 *
 * `classify` reads the structured fields the API returns, which presumes the
 * API answered. Nothing classified a failure to reach it at all, because
 * nothing caught one: the console had no error boundary, so an unreachable API
 * took the whole route out with a stack trace.
 *
 * Node reports a refused or unresolvable connection as a bare `fetch failed`
 * with the real code on `cause`, so both are checked. The `cause` chain only
 * survives on the server; a React error boundary receives the message alone,
 * and in production Next replaces even that with a digest. That is why the
 * message test is deliberately broad and the fallback is honest rather than
 * specific — a boundary that guesses "API unreachable" for every production
 * error would be inventing a diagnosis, which is the failure mode this
 * taxonomy exists to prevent.
 */
export function classifyThrown(err: unknown): ConsoleError {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const cause: unknown = err instanceof Error ? err.cause : undefined;
  const codes: string[] = [];
  if (cause && typeof cause === "object") {
    const c = cause as { code?: unknown; errors?: { code?: unknown }[] };
    if (typeof c.code === "string") codes.push(c.code);
    for (const e of c.errors ?? []) if (typeof e?.code === "string") codes.push(e.code);
  }
  const haystack = `${message} ${codes.join(" ")}`;
  if (
    /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|UND_ERR|Failed to fetch|NetworkError/i.test(
      haystack,
    )
  ) {
    return { ...ERROR_COPY.api_unreachable, detail: message };
  }
  /**
   * `lib/api.ts` throws this exact shape for any non-ok status, and a 5xx from
   * the console's own API is a different problem from a 4xx — the first is the
   * API's fault, the second is this client asking for something wrong. Only
   * the first gets the API's name on it.
   */
  const status = /request failed: (\d{3})/.exec(message)?.[1];
  if (status && Number(status) >= 500) {
    return { ...ERROR_COPY.api_error, detail: message };
  }
  return classify({ detail: message });
}

/**
 * Empty-state copy, from `docs/03`.
 *
 * Each one explains rather than shrugs, and the last is a rule as much as a
 * string: no disabled fake balance, because a greyed-out number reads as a
 * number.
 */
export const EMPTY_STATES = {
  noAgents: {
    title: "No agents yet",
    detail: "Create your first agent identity under your ENSv2 namespace.",
  },
  noGraphMatch: {
    title: "No live Agent0 result matched this request.",
    detail: "The subgraph answered; nothing it returned fits these criteria.",
    action: "Search all MCP agents",
  },
  noWallet: {
    title: "Financial authority has not been configured for this agent.",
    detail: "No wallet, no policy, and therefore no balance to show.",
  },
  noValidation: {
    title: "Validation unavailable",
    detail:
      "No ValidationRegistry is deployed on this network. This agent has not been validated either way — it has not scored zero.",
  },
} as const;
