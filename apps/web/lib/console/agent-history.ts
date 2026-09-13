import type { Status } from "@/components/console/outcome-status";

/**
 * One agent's log, counted by source and outcome.
 *
 * The fleet's version of this is `/v1/activity/summary`, computed in SQL over
 * every event. This one is not that, and the difference is deliberate: the
 * summary route counts the whole log and takes no agent filter, so asking it
 * about one agent is not a thing it can answer. The inspector already fetches
 * that agent's events to show them; counting the page it holds costs nothing
 * and needs no second round trip.
 *
 * The cost is that the count is of the page, not of the log. `PAGE` is the cap
 * and `truncated` is how the caller knows which of the two it is holding — a
 * chart that says "12 events" when the log has four hundred is worse than one
 * that says it is showing the most recent two hundred.
 *
 * See `docs/09_DATA_AND_EVENT_MODEL.md` for the event shape.
 */

/** The outcomes, in the order a stack should read: best-known first. */
export const STATUSES: readonly Status[] = [
  "success",
  "denied",
  "failed",
  "pending",
] as const;

/** How many events the inspector asks for. */
export const PAGE = 200;

export interface HistoryRow extends Record<string, unknown> {
  source: string;
  success: number;
  denied: number;
  failed: number;
  pending: number;
  total: number;
}

export interface History {
  rows: HistoryRow[];
  total: number;
  /** The log had at least `PAGE` events, so these counts are of a page of it. */
  truncated: boolean;
  /** Distinct days the page spans — the caller decides what is too few to plot. */
  days: number;
}

type Event = { source: string; status: string; occurredAt: string };

export function summarise(events: readonly Event[]): History {
  const bySource = new Map<string, HistoryRow>();
  const days = new Set<string>();

  for (const event of events) {
    /*
      A status the union does not have is counted into `total` and into no
      column. Dropping the row instead would make the bars disagree with the
      figure beside them, and inventing a fifth column for one unrecognised
      value would put a legend entry on screen that names nothing.
    */
    const row =
      bySource.get(event.source) ??
      ({
        source: event.source,
        success: 0,
        denied: 0,
        failed: 0,
        pending: 0,
        total: 0,
      } satisfies HistoryRow);

    if ((STATUSES as readonly string[]).includes(event.status)) {
      row[event.status as Status] += 1;
    }
    row.total += 1;
    bySource.set(event.source, row);

    // The date, not the instant: "how many days has this agent been doing
    // anything" is the question the chart's own honesty depends on.
    days.add(event.occurredAt.slice(0, 10));
  }

  const rows = [...bySource.values()].sort((a, b) => b.total - a.total);

  return {
    rows,
    total: events.length,
    truncated: events.length >= PAGE,
    days: days.size,
  };
}
