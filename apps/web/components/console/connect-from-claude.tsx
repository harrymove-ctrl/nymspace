"use client";

import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useState } from "react";
import { Absent } from "./primitives";

/**
 * Connect from Claude — what to run so a local Claude Code can use an agent's
 * MCP server, built from the endpoint that agent published.
 *
 * The URL is always the live published value, never one this deployment would
 * derive from `AGENT_MCP_BASE_URL`. The record is the agent's claim about where
 * it answers; a snippet built from config would keep looking right after the
 * record stopped naming anything. The query string and fragment are dropped
 * because the permission proof writes `?proof=<ts>` to force a changing value,
 * and that stamp means nothing to a client.
 *
 * The record is written by the agent's controller, not by Nymspace, and this
 * renders a command someone will paste into a shell. So only an https URL is
 * accepted, and anything outside a conservative character set is
 * single-quoted — a path segment like `$(…)` survives URL parsing unencoded.
 *
 * Nothing here dials the endpoint. Whether it answers is the Connect button's
 * question; this only hands the operator what to run.
 *
 * ## Two sources, and the difference is not cosmetic
 *
 * A fleet agent's endpoint comes from an ENS record this organization's
 * controller wrote, and points at a server in `mcp/servers.ts` that is
 * read-only by construction. A discovered agent's endpoint comes from an ERC
 * 8004 registration, and points at a server nobody here has audited — its tools
 * can charge money (Assay's `assay_agent` costs 1000000 tinybar over x402) and
 * nothing in this product constrains what they do.
 *
 * Those are different facts about what the operator is about to add to their
 * own machine, so `source` carries which one it is and the panel says so. One
 * component with one shared snippet would have quietly told somebody that a
 * paid, unaudited tool server is read-only.
 *
 * The discovered warning is about *provenance*, not about ownership — it says
 * the endpoint came from a registration rather than from an ENS record this
 * organization wrote. Wording it as "a third party's server" was wrong the
 * moment `research.nymspace.eth` came back in its own Discover results: the
 * console would have called this organization's own agent a stranger, on a card
 * showing its ENS name. Where the endpoint was read from is true of every
 * result; who owns it is not this panel's claim to make.
 */

export type McpClientSource =
  | { kind: "fleet"; ensName: string; label: string }
  | {
      kind: "graph";
      agentId: string;
      name: string | null;
      ensName: string | null;
    };

export function ConnectFromClaude({
  source,
  endpoint,
}: {
  source: McpClientSource;
  endpoint: string;
}) {
  const [open, setOpen] = useState(false);
  const url = clientUrl(endpoint);

  return (
    <VStack gap={3} paddingBlock={2}>
      <HStack gap={3} align="center" wrap="wrap">
        <Button
          variant="secondary"
          size="sm"
          label={open ? "Hide Claude setup" : "Connect from Claude"}
          /*
            The label already says which way this goes; `aria-expanded` says it
            to a screen reader, which had only the changing label to go on and
            no way to know the two states belong to one control. The sound layer
            reads the same attribute, so the panel opens and closes audibly
            instead of answering both directions with the same press.
          */
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        />
        <Text type="supporting" size="sm">
          {source.kind === "fleet"
            ? "Add this agent's MCP server to Claude Code on your computer."
            : "Add this agent's MCP server to Claude Code on your computer. The endpoint is the one this agent registered under ERC 8004, not one this organization wrote."}
        </Text>
      </HStack>

      {open ? (
        url ? (
          <ClaudeSetup source={source} url={url} />
        ) : (
          <Absent
            what={
              source.kind === "fleet"
                ? "the published record is not an https URL, so there is nothing to add"
                : "the endpoint in this registration is not an https URL, so there is nothing to add — live Agent0 results include localhost and pages that are not endpoints at all"
            }
          />
        )
      ) : null}
    </VStack>
  );
}

function ClaudeSetup({
  source,
  url,
}: {
  source: McpClientSource;
  url: string;
}) {
  const name = serverName(source);
  const command = `claude mcp add --transport http --scope user ${quote(name)} ${quote(url)}`;
  const prompt = promptFor(source, name, url, command);

  return (
    <VStack gap={2}>
      <Text type="supporting" size="sm">
        Run in a terminal. The user scope makes it available in every project.
      </Text>
      <CodeBlock code={command} language="bash" size="sm" width="100%" isWrapped />

      <Text type="supporting" size="sm">
        Or paste this prompt into Claude Code and let it do the setup.
      </Text>
      <CodeBlock
        code={prompt}
        language="plaintext"
        title="Prompt"
        size="sm"
        width="100%"
        isWrapped
      />
    </VStack>
  );
}

/**
 * The prompt, written per source.
 *
 * The fleet one names `describe_agent` because `mcp/servers.ts` is this
 * repository and that tool is certain to be there. The discovered one must not
 * name a tool: the tool list is the remote server's own claim, it arrived from
 * a handshake rather than from source, and a prompt that tells Claude to call
 * `assay_agent` is a prompt that tells Claude to spend money on a stranger's
 * endpoint. So it asks for the list and stops there — the operator decides what
 * to call next, which is the same line the Connect button already draws.
 */
function promptFor(
  source: McpClientSource,
  name: string,
  url: string,
  command: string,
): string {
  const restart = `A newly added server loads when a session starts, so tell me to restart Claude Code.`;

  if (source.kind === "fleet") {
    return [
      `Add the MCP server for the agent ${source.ensName} to Claude Code.`,
      ``,
      `Its endpoint is ${url}, read from that name's agent-endpoint[mcp] ENS record.`,
      ``,
      `1. Run: ${command}`,
      `2. Run: claude mcp get ${quote(name)} and confirm it is configured.`,
      `3. ${restart} In the new session, call its describe_agent tool and summarise what it reports.`,
      ``,
      `The server is read-only. The name it reports for itself is self-reported, not verified.`,
    ].join("\n");
  }

  const who = source.ensName ?? source.name ?? `ERC 8004 agent #${source.agentId}`;

  return [
    `Add the MCP server for ${who} to Claude Code.`,
    ``,
    `Its endpoint is ${url}, read from the ERC 8004 registration this agent published — Agent0 subgraph, agent id ${source.agentId}.`,
    ``,
    `1. Run: ${command}`,
    `2. Run: claude mcp get ${quote(name)} and confirm it is configured.`,
    `3. ${restart} In the new session, list the tools this server offers and tell me what each one claims to do. Do not call any of them yet.`,
    ``,
    `This endpoint came from a public registration rather than from Nymspace. Nobody here audited the server, its tools are not read-only, and some of them charge — so treat the tool list as the server's own claim and ask me before calling anything.`,
  ].join("\n");
}

/**
 * What the server is called in `claude mcp add`.
 *
 * A fleet agent has an ENS label, which is already a slug and already unique
 * under the parent name. A discovered agent has whatever string its registration
 * carries, so it is slugged, and an empty slug falls back to the agent id rather
 * than to a bare name — `agent-9200` says which registration it came from, and
 * `claude mcp add ''` would not have run at all.
 */
function serverName(source: McpClientSource): string {
  if (source.kind === "fleet") return source.label;
  const slug = (source.name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `agent-${source.agentId}`;
}

/** The record as a client should dial it, or null when it is not https. */
function clientUrl(record: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(record);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

/** Bare when plainly safe in a POSIX shell, single-quoted otherwise. */
function quote(value: string): string {
  if (/^[A-Za-z0-9._~:/@%+=,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
