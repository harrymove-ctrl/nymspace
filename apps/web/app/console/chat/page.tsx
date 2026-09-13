import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { CONSOLE_SUGGESTIONS } from "@nymspace/core";
import { ChatConsole } from "@/components/console/chat-console";
import { Frame } from "@/components/console/primitives";

/**
 * The chat console.
 *
 * Server component so the opening suggestions come from one place, but the
 * conversation itself is client-side: every answer is a read performed at the
 * moment it is asked for, and caching that would be the one thing this screen
 * must not do.
 *
 * Framed and headed like every other console screen. It arrived from another
 * branch wearing its own layout — a bare `main` with its own max width and its
 * own heading sizes — which put a second page frame inside the shell's. The
 * screens differ in what they show, not in how they are built.
 */

export const dynamic = "force-dynamic";

export default function ChatPage() {
  return (
    <VStack as="main" gap={8} width="100%" className="min-w-0">
      <VStack as="header" gap={3} maxWidth="42rem">
        <Heading level={1}>
          <Text type="code" size="2xl">
            Console
          </Text>
        </Heading>
        <Text type="supporting" as="p">
          Ask about an agent. Every answer is assembled from a read performed
          when you ask — ENSv2 for records and authority, the ERC 8004 registry
          for the registration, each on its own chain. Nothing in an answer is
          generated. A question the console cannot place directly is handed to
          a model, which chooses which read to perform and writes none of it;
          answers that went that way say so.
        </Text>
      </VStack>

      {/* The conversation owns its own scrolling and pins itself to the
          newest turn, so a second scroller around it would fight it for the
          scroll position. See `components/console/bend.tsx`. */}
      <Frame surface="body" title="console" bend={false}>
        <ChatConsole suggestions={CONSOLE_SUGGESTIONS} />
      </Frame>
    </VStack>
  );
}
