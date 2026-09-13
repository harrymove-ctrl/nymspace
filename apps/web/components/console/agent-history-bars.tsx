"use client";

import { Card } from "@astryxdesign/core/Card";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { Bar, BarChart, Tooltip, XAxis, YAxis } from "recharts";
import { DitherDefs, DitherSwatch, ditherFill } from "./dither";
import { MARGIN, chartHeight, type Status } from "./outcome-status";
import { STATUSES, type HistoryRow } from "@/lib/console/agent-history";

/**
 * One agent's log, as dithered bars.
 *
 * The second module in this app that imports recharts, and loaded the same way
 * the first one is — `agent-history.tsx` pulls it in with `dynamic`, because
 * recharts costs the inspector +127 KB gzipped it does not need to render an
 * identity, a permission matrix or a payment form. See the note at the top of
 * `outcome-bars.tsx`; this is the same trade on a second page.
 *
 * The bars are stacked and the stack is the point: a source is one row, and
 * what the row is made of is how that source has gone. Sorted by volume, so
 * the source this agent actually lives on is the first thing read.
 */

const BAR_SIZE = 18;
const AXIS_WIDTH = 96;
const AXIS_TICK = { fill: "var(--color-text-secondary)" };
const CURSOR = { fill: "var(--color-background-muted)" };

/**
 * Scoped to this chart, because pattern ids are document-global and the fleet's
 * chart may be on screen at the same time. See `DitherDefs`.
 */
const ID = "agent-history-dither";

export default function AgentHistoryBars({ rows }: { rows: HistoryRow[] }) {
  const totals = new Map(rows.map((row) => [row.source, row.total]));

  /*
    Only the outcomes this agent actually has.

    Four legend entries against a bar made of one is a key to three textures
    that are not on screen, which reads as "these are missing" rather than
    "these never happened".
  */
  const present = STATUSES.filter((s) => rows.some((row) => row[s] > 0));

  const described = rows
    .map(
      (row) =>
        `${row.source}: ${present.map((s) => `${row[s]} ${s}`).join(", ")}`,
    )
    .join("; ");

  return (
    <VStack gap={3} width="100%" className="min-w-0">
      <DitherDefs idPrefix={ID} />

      <BarChart
        data={rows}
        layout="vertical"
        responsive
        width="100%"
        height={chartHeight(rows.length)}
        margin={MARGIN}
        barSize={BAR_SIZE}
        title="Events by source and outcome, for this agent"
        desc={`Events by source and outcome for this agent. ${described}.`}
      >
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="source"
          width={AXIS_WIDTH}
          axisLine={false}
          tickLine={false}
          tick={AXIS_TICK}
          // The count in the tick, for the same reason the fleet chart does it:
          // a one-event source beside an eight-event one is a sliver, and the
          // number is what keeps it readable.
          tickFormatter={(value: string) => `${value} · ${totals.get(value) ?? 0}`}
        />
        <Tooltip cursor={CURSOR} content={<HistoryTooltip statuses={present} />} />
        {present.map((s) => (
          <Bar
            key={s}
            dataKey={s}
            name={s}
            stackId="outcome"
            fill={ditherFill(ID, s)}
          />
        ))}
      </BarChart>

      <HStack gap={4} wrap="wrap">
        {present.map((s) => (
          <HStack key={s} gap={2} align="center">
            <DitherSwatch idPrefix={ID} status={s} />
            <Text type="supporting" size="sm">
              {s}
            </Text>
          </HStack>
        ))}
      </HStack>
    </VStack>
  );
}

/** One source's breakdown, in the same surface the fleet chart's tooltip uses. */
function HistoryTooltip({
  active,
  payload,
  statuses,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: HistoryRow }>;
  statuses: Status[];
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;

  return (
    <Card padding={3} elevation="low">
      <VStack gap={1}>
        <Text type="code" size="sm" hasTabularNumbers>
          {row.source} · {row.total}
        </Text>
        {statuses.map((s) => (
          <HStack key={s} gap={2} align="center">
            <DitherSwatch idPrefix={ID} status={s} />
            <Text type="supporting" size="sm" hasTabularNumbers>
              {row[s]} {s}
            </Text>
          </HStack>
        ))}
      </VStack>
    </Card>
  );
}
