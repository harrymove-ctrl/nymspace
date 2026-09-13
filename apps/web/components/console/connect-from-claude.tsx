import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { CopyableValue } from "./copyable-value";

/**
 * The one command that points a Claude Code install at this agent.
 *
 * `McpConnect` above it answers whether the endpoint responds, from this API,
 * once. This answers the question the reader has immediately afterwards, which
 * is how to reach the same endpoint from their own machine — and the answer is
 * not a link, because an MCP endpoint is not a page. Without this the console
 * proved an agent was dialable and then left the reader to construct the
 * command from a record key and an origin.
 *
 * No `"use client"`. The clipboard lives in {@link CopyableValue}, which is
 * the client boundary; this module is the text around it and is rendered by a
 * server component (`app/console/agents/[id]/page.tsx`).
 *
 * ## What is copied is what ENS published
 *
 * `endpoint` is the `agent-endpoint[mcp]` record read during the request, never
 * a value rebuilt from `AGENT_MCP_BASE_URL`. A command built from local config
 * would dial whatever this deployment happens to be pointed at, which is the
 * one thing the published record exists to stop being a guess — and the caller
 * only renders this when that record exists.
 */
export function ConnectFromClaude({
  ensName,
  label,
  endpoint,
}: {
  /** The agent's full name, for the sentence that says what is being added. */
  ensName: string;
  /** The subname label, used verbatim as the MCP server name. */
  label: string;
  /** The `agent-endpoint[mcp]` record, as read from chain this request. */
  endpoint: string;
}) {
  /*
    `--transport http`, because the published record is an https URL and the
    default transport is stdio — a command that omits it fails with a message
    about spawning a process, which sends the reader to look at their shell
    rather than at the flag.

    The label is the server name: it is already unique under the parent, and a
    reader with three agents connected wants to see which is which.
  */
  const command = `claude mcp add --transport http ${label} ${endpoint}`;

  return (
    <VStack gap={1} paddingBlock={2} className="frame-rule-below last:bg-none">
      <HStack gap={4} justify="between" align="end">
        <Text type="supporting" size="sm">
          connect from Claude Code
        </Text>
      </HStack>
      <CopyableValue value={command} label="Connect command" />
      <Text type="supporting" size="xsm" as="p">
        Adds {ensName} as an MCP server on this machine. It grants nothing: the
        endpoint serves the tools the agent chose to publish, and every write
        behind them is still checked against the resolver.
      </Text>
    </VStack>
  );
}
