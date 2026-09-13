"use client";

import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import dynamic from "next/dynamic";
import { Absent, Loading, Provenance } from "./primitives";
import type { History } from "@/lib/console/agent-history";
import { PAGE } from "@/lib/console/agent-history";

/**
 * What this agent has actually done, counted.
 *
 * The inspector's other five sections are all *state* — who owns the name,
 * what the key may write, which policy caps the wallet. Every one of them is
 * true right now and says nothing about whether the agent has ever been used.
 * This is the only section that is history, which is why it is worth a chart
 * rather than another row of fields.
 *
 * ## The threshold, and why there is one
 *
 * A chart implies a distribution, and three events are not one. Below
 * `MIN_EVENTS` this renders the sentence instead — the same instinct as
 * `Absent`: `docs/04` forbids inventing reputation, and the easiest way to
 * invent it is to draw four bars of height one and let them look like a
 * pattern.
 *
 * The bars load after the page (`dynamic`, `ssr: false`) for the reason
 * `outcome-chart.tsx` gives: recharts is +127 KB gzipped, and an inspector
 * whose identity, permission matrix and payment form all work without it
 * should not wait for it.
 */

/** Below this, the counts are stated and not plotted. */
const MIN_EVENTS = 5;

const AgentHistoryBars = dynamic(() => import("./agent-history-bars"), {
  ssr: false,
  loading: () => <Loading what="Drawing this agent's history" />,
});

export function AgentHistory({
  history,
  readAt,
}: {
  history: History;
  /** When the log was read, so the count carries its own provenance. */
  readAt: string;
}) {
  const { rows, total, truncated, days } = history;

  if (total === 0) {
    return (
      <VStack gap={2} maxWidth="42rem">
        <Absent what="nothing recorded yet — this agent has not been used" />
        <Provenance source="store" readAt={readAt} />
      </VStack>
    );
  }

  if (total < MIN_EVENTS) {
    /*
      Counted in a sentence rather than drawn. Naming the sources keeps the
      information the chart would have carried; what is dropped is the
      suggestion that four events have a shape.
    */
    return (
      <VStack gap={2} maxWidth="42rem">
        <Text type="supporting" as="p">
          {total} {total === 1 ? "event" : "events"} so far, across{" "}
          {rows.map((row) => `${row.source} (${row.total})`).join(", ")}. Too few
          to plot — a chart of this would be four bars of height one wearing the
          shape of a trend.
        </Text>
        <Provenance source="store" readAt={readAt} />
      </VStack>
    );
  }

  return (
    <VStack gap={3} width="100%" className="min-w-0">
      <VStack maxWidth="42rem">
        <Text type="supporting" as="p">
          {total} {total === 1 ? "event" : "events"} across {rows.length}{" "}
          {rows.length === 1 ? "source" : "sources"}
          {days > 1 ? `, over ${days} days` : ""}. Each bar is one source; what
          it is made of is how that source has gone.
        </Text>
      </VStack>

      <AgentHistoryBars rows={rows} />

      {/*
        Said only when it is true. The counts are of the page the inspector
        holds, and at the cap that is no longer the same thing as the log —
        a reader comparing this figure against the Activity screen deserves to
        know which of the two they are looking at.
      */}
      {truncated ? (
        <Text type="supporting" size="sm">
          Showing the most recent {PAGE} events. The full log is on the Activity
          screen.
        </Text>
      ) : null}

      <Provenance source="store" readAt={readAt} />
    </VStack>
  );
}
