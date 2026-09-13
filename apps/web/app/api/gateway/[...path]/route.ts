import { apiBaseUrl } from "@/lib/api";

/**
 * The console's writes, signed on the server.
 *
 * Every route that spends the organization's money — registering a subname,
 * granting a permission, writing a record, sending a payment — now needs a
 * bearer token (`apps/api/src/write-gate.ts`). The browser cannot hold one: a
 * token in client JavaScript is a token in view source, and this console is
 * served to anyone who can open it.
 *
 * So the browser posts here instead, same-origin, and this handler adds the
 * credential on its way out. `CONSOLE_MCP_TOKEN` is read from the server
 * environment and is deliberately not `NEXT_PUBLIC_` — Next inlines those into
 * the bundle, which is the exact failure this exists to avoid.
 *
 * ## What this is not
 *
 * Not authentication. Anyone who can reach this console can still reach these
 * writes through it, exactly as before — what changed is that they can no
 * longer reach them by `curl`ing the API directly from anywhere on the
 * internet, which was the open door. Putting a real identity in front of the
 * console is a separate change and a larger one; this closes the hole that
 * needed no account at all.
 *
 * Not a general proxy either. The path is rebuilt from the segments rather than
 * taken from a query parameter, and only `/v1/*` is forwarded, so it cannot be
 * pointed at somebody else's host.
 */

/** Only the product API, and only its versioned surface. */
function targetFor(segments: string[]): URL | undefined {
  if (segments[0] !== "v1") return undefined;
  // `URL` with a base cannot escape the origin here: every segment is
  // percent-encoded, so `..` arrives as a literal path component rather than
  // climbing out of `/v1`.
  return new URL(
    segments.map(encodeURIComponent).join("/"),
    `${apiBaseUrl.replace(/\/+$/, "")}/`,
  );
}

/**
 * The console MCP server, which is the one path that is not a plain JSON POST.
 *
 * Streamable HTTP needs three things this gateway did not give it: an `accept`
 * header naming both `application/json` and `text/event-stream`, a `GET` for
 * the event stream and a `DELETE` to end a session, and the `Mcp-Session-Id`
 * header carried in both directions. Without the first, every handshake came
 * back `406 Not Acceptable` — from the MCP server itself, which means the
 * server was deployed, configured and reachable the whole time and no client
 * could complete a single call.
 *
 * Widened for this path only. Forwarding arbitrary methods across all of
 * `/v1/*` would open every read and delete on the API through a path this
 * file's own header says is not authentication; the MCP endpoint needs them
 * and nothing else does.
 */
const MCP_CONSOLE = ["v1", "mcp", "console"];

function isMcpConsole(segments: string[]): boolean {
  return (
    segments.length === MCP_CONSOLE.length &&
    segments.every((segment, i) => segment === MCP_CONSOLE[i])
  );
}

/**
 * Named, rather than copied from the request wholesale.
 *
 * A proxy that forwards whatever it was given also forwards `cookie` and
 * `origin`, and this one adds a credential — so what crosses is a list, and
 * adding to it is a decision someone makes on purpose.
 */
const FORWARDED = [
  "content-type",
  "accept",
  "mcp-session-id",
  "mcp-protocol-version",
  "last-event-id",
];

/** What the client needs back to keep a session and read a stream. */
const RETURNED = ["content-type", "mcp-session-id", "cache-control"];

async function forward(
  request: Request,
  path: string[],
  method: "POST" | "GET" | "DELETE",
) {
  const token = process.env.CONSOLE_MCP_TOKEN;
  if (!token) {
    // The same shape and the same reason the API gives: unconfigured refuses,
    // rather than passing an unsigned write along to be refused further out
    // with a message about a variable this deployment is the one missing.
    return Response.json(
      {
        error:
          "this console cannot perform writes: CONSOLE_MCP_TOKEN is not set on the web app",
        status: 503,
      },
      { status: 503 },
    );
  }

  const target = targetFor(path);
  if (!target) {
    return Response.json({ error: "not found", status: 404 }, { status: 404 });
  }

  target.search = new URL(request.url).search;

  const headers = new Headers({ authorization: `Bearer ${token}` });
  for (const name of FORWARDED) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("content-type")) headers.set("content-type", "application/json");

  const response = await fetch(target, {
    method,
    headers,
    ...(method === "POST" ? { body: await request.text() } : {}),
  });

  /*
    The upstream body and status are passed through unchanged.

    A denial from the resolver and a refusal from a spend policy both arrive
    here as ordinary 200s carrying a typed outcome, and `docs/11` is explicit
    that those must not be re-dressed as errors. Rewriting anything on this path
    would put a second opinion between the contract and the screen.

    `response.body` rather than a buffered copy, because the MCP transport
    answers with an event stream that never ends on its own.
  */
  const out = new Headers();
  for (const name of RETURNED) {
    const value = response.headers.get(name);
    if (value) out.set(name, value);
  }
  if (!out.has("content-type")) out.set("content-type", "application/json");

  return new Response(response.body, { status: response.status, headers: out });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return forward(request, path, "POST");
}

/** The MCP event stream. Every other path keeps answering 404 to a `GET`. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  if (!isMcpConsole(path)) {
    return Response.json({ error: "not found", status: 404 }, { status: 404 });
  }
  return forward(request, path, "GET");
}

/** Ending an MCP session. Same narrowing as `GET`. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  if (!isMcpConsole(path)) {
    return Response.json({ error: "not found", status: 404 }, { status: 404 });
  }
  return forward(request, path, "DELETE");
}
