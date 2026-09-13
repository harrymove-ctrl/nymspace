"use client";

import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useEffect } from "react";
import { classifyThrown } from "@/lib/console/errors";

/**
 * The console's error boundary — the first one in the app.
 *
 * Every screen under `/console` is server-rendered from the API, and
 * `lib/api.ts` throws on a bad status while `fetch` itself throws when the API
 * is not there at all. Nothing caught either: with no `error.tsx` anywhere in
 * `app/`, a stopped API took the whole route out — a stack trace in
 * development and a bare 500 in production, from a console whose entire
 * subject is telling an operator what a system is doing.
 *
 * Two rules this file inherits rather than invents.
 *
 * **It says which system failed.** The copy comes from `classifyThrown`, so an
 * unreachable API is not dressed up as an unreachable Sepolia. `docs/03`'s
 * taxonomy exists because "Blocked by identity policy" and "Sepolia RPC
 * unavailable" are opposite claims about an agent's authority; reporting the
 * console's own process as a chain fault is the same error one layer out.
 *
 * **It never claims a write happened.** A failure here is a failed *read* —
 * the screens are server-rendered on load — so the copy says nothing was read
 * and nothing was written, which is true and is the first thing an operator
 * needs to know before retrying.
 *
 * `reset()` re-runs the failed render rather than reloading, so a retry after
 * starting the API lands on the console instead of on a fresh boot.
 */
export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const problem = classifyThrown(error);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3112";

  useEffect(() => {
    // The digest is the only handle on the server-side stack once production
    // has stripped the message, so it goes to the browser console where a
    // developer can read it back against the deployment's logs.
    console.error("console route failed", error.digest ?? "", error);
  }, [error]);

  return (
    <VStack as="main" gap={5} width="100%" maxWidth="42rem" className="min-w-0">
      <VStack gap={2}>
        <Heading level={1}>
          <Text type="body" size="xl">
            {problem.title}
          </Text>
        </Heading>
        {problem.action ? (
          <Text type="supporting" as="p">
            {problem.action}
          </Text>
        ) : null}
      </VStack>

      {problem.kind === "api_unreachable" ? (
        <VStack gap={2}>
          <Text type="supporting" as="p">
            The console expects the API at{" "}
            <Text type="code" size="sm">
              {apiUrl}
            </Text>
            .
          </Text>
        </VStack>
      ) : null}

      {/*
        The raw message, not instead of the classified copy but under it.
        Production replaces it with a digest, so this is frequently empty —
        which is why it is a supporting detail and never the headline.
      */}
      {problem.detail ? (
        <Text type="code" size="sm" color="secondary">
          {problem.detail}
        </Text>
      ) : null}

      <HStack gap={3} wrap="wrap" align="center">
        <Button label="Retry" variant="primary" onClick={() => reset()} />
        {error.digest ? (
          <Text type="code" size="sm" color="secondary">
            digest {error.digest}
          </Text>
        ) : null}
      </HStack>
    </VStack>
  );
}
