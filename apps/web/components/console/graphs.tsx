import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { Frame } from "./frame";

/**
 * The console's figures — markdown graphs, in the console's own parts.
 *
 * The register is `mdx-graphs.kshv.me`: a dashed frame with a bracketed title
 * and everything inside it made of characters. Each graph here keeps the
 * registry's own props, so a call written against the docs compiles against
 * this file and a reader who knows one knows the other.
 *
 * | here         | docs page      | draws                        |
 * | ------------ | -------------- | ---------------------------- |
 * | `GraphFlow`  | `graph-flow`   | a path: nodes and arrows     |
 * | `GraphCheck` | `graph-check`  | a punch list, `[x]` / `[ ]` |
 * | `GraphMeter` | `graph-meter`  | one fill from 0 to 1         |
 * | `GraphTree`  | `graph-tree`   | nesting, `├─` and `└─`   |
 *
 * Three more were considered and are deliberately absent, because the wrong
 * figure is worse than none:
 *
 *  - `GraphCells` draws a filled/empty grid with one caption underneath and no
 *    row or column labels. The obvious home for it was the authority matrix,
 *    which is exactly where it must not go: a permission grid a reader cannot
 *    index — which row is `agent-context`, which is `unregister` — is a
 *    diagram that hides the one thing it is about. `AuthorityMatrix` stays a
 *    labelled table.
 *  - `GraphRank` wants a short ranked list. Nothing on an agent's page ranks;
 *    its capabilities are a set, not an order.
 *  - `GraphDiff` fits the permission proof's shape exactly — a record before
 *    and after a write — and still loses on the substance. Those two values are
 *    `Field`s, which cannot render a value read from outside this process
 *    without saying which system and when; a diff row is a label and a number.
 *    Trading provenance for a `+` and a `-` on the one panel whose entire
 *    purpose is evidence would be a bad trade.
 *
 * ## Why it is written rather than installed
 *
 * `components/console/frame.tsx` already answered this for the frame itself and
 * the answer holds for everything drawn inside one: the register is the
 * reference, the implementation is Astryx, and nothing from the registry is in
 * the tree. Running `shadcn add graph-flow` would have brought a second frame —
 * `graph-frame.tsx`, with its own corner marks and its own `[ title ]` — that
 * punches its edge with `bg-background`. The console spent `app/console/layout.tsx`'s
 * longest comment reconciling `--background` against the Astryx body token
 * precisely because two token systems both claiming "the page background" put a
 * visibly tinted lozenge behind every frame title. Installing it would have
 * reintroduced that bug, in a component whose whole job is to look deliberate.
 *
 * It would also have arrived with `@/lib/utils`, `text-graph-accent`,
 * `text-graph-frame` and a `motion` entrance — a fourth naming system for
 * colours the theme already has, and an animation the console's own
 * `row-enter`/`view-enter` rhythm already covers.
 *
 * ## Where it departs
 *
 * The title is left-anchored, because `Frame` anchors it left. That departure
 * from the centred reference is `Frame`'s, made deliberately and documented
 * there — runtime strings overflow a centred `nowrap` caption. A flow that
 * re-centred its own title would be a second frame style on one screen, which
 * is the thing both files exist to prevent.
 */

/** Upstream's three tones, and nothing invented beside them. */
type FlowTone = "default" | "accent" | "muted";

export interface FlowNode {
  /** Lowercase and plain: `preview the spend limit`, not `SpendLimitCheck`. */
  label: string;
  tone?: FlowTone;
  /** Let this node take the remaining width, its arrow drawn as a rule. */
  stretch?: boolean;
}

export interface FlowRow {
  nodes: FlowNode[];
}

/**
 * Tone to a theme colour.
 *
 * Three, matching upstream, and no fourth. The temptation on the run flow is a
 * red for a step that failed unexpectedly, and it is the wrong instinct twice
 * over: the register spends one accent and nothing else, and the failure is
 * already stated in full underneath the figure, in a component built to state
 * it. A diagram that carried the alarm as well would be a second place to get
 * the severity of a refusal wrong — which `docs/03` is specifically about.
 */
const TONE: Record<FlowTone, "primary" | "secondary" | "accent"> = {
  default: "primary",
  accent: "accent",
  muted: "secondary",
};

export function GraphFlow({
  title,
  rows,
}: {
  title: string;
  rows: FlowRow[];
}) {
  return (
    <Frame surface="body" title={title}>
      <VStack gap={6} width="100%" className="min-w-0">
        {rows.map((row, rowIndex) => (
          /*
            `wrap` is the whole responsive story, and it is upstream's too: a
            path that does not fit becomes several lines rather than a
            horizontal scroller. The labels are the steps' own titles — short
            phrases, not identifiers — so at console width a two or three step
            plan sits on one line and a phone gets one node per line with the
            arrows still between them.
          */
          <HStack
            key={rowIndex}
            gap={3}
            align="center"
            wrap="wrap"
            width="100%"
            className="min-w-0"
          >
            {row.nodes.map((node, nodeIndex) => (
              <HStack
                key={`${node.label}-${nodeIndex}`}
                gap={3}
                align="center"
                className={node.stretch ? "min-w-0 flex-1" : "min-w-0"}
              >
                {/*
                  The arrow belongs to the node it points at, not to the one
                  before it — which is why it is drawn here and skipped on the
                  first. Upstream does the same, and it is what lets a node
                  carry its own arrow's emphasis: an accent step is reached by
                  an accent arrow.
                */}
                {nodeIndex > 0 ? (
                  <Arrow
                    accent={node.tone === "accent"}
                    stretch={node.stretch}
                  />
                ) : null}
                <Text
                  type="code"
                  size="sm"
                  color={TONE[node.tone ?? "default"]}
                  textWrap="nowrap"
                >
                  {node.label}
                </Text>
              </HStack>
            ))}
          </HStack>
        ))}
      </VStack>
    </Frame>
  );
}

/**
 * `- - - ▶`, or a rule and an arrowhead when the node it points at stretches.
 *
 * The dashes are characters rather than a border, because in this register a
 * diagram is made of type — the same reason the corner marks are `+` and the
 * intensity ramps are `░▒▓`. The stretching variant is the exception and uses
 * `frame-rule`, the console's own dashed hairline, so a rule that spans a row
 * has the same 2-on-5-off rhythm as the frame around it rather than a second
 * dash pattern the browser chose.
 */
function Arrow({
  accent,
  stretch,
}: {
  accent: boolean;
  stretch?: boolean;
}) {
  const color = accent ? "accent" : "secondary";

  return (
    <HStack
      aria-hidden
      gap={1}
      align="center"
      className={stretch ? "min-w-0 flex-1" : "min-w-0"}
    >
      {stretch ? (
        <VStack className="frame-rule min-w-6 flex-1" />
      ) : (
        <Text type="code" size="sm" color={color} textWrap="nowrap">
          - - -
        </Text>
      )}
      <Text type="code" size="sm" color={color} textWrap="nowrap">
        ▶
      </Text>
    </HStack>
  );
}

/* ── Check ─────────────────────────────────────────────────────────────── */

export interface CheckItem {
  label: string;
  done?: boolean;
  /** One line under the label, for why it is not done or what did it. */
  note?: string;
}

/**
 * A punch list — `mdx-graphs.kshv.me/docs/graph-check`.
 *
 * `[x]` and `[ ]` in the first column, the item in the second, an optional note
 * under it. Done items take the foreground and the accent mark; the rest
 * recede, which is the register's rule that unused rows sit back rather than
 * disappear.
 *
 * The mark is a character and not a checkbox on purpose, beyond the register:
 * a checkbox is a control, and every list this draws is a report. Nobody should
 * be able to click an agent into having a wallet.
 */
export function GraphCheck({
  title,
  items,
}: {
  title: string;
  items: CheckItem[];
}) {
  const done = items.filter((item) => item.done).length;

  return (
    <Frame surface="body" title={title}>
      <VStack as="ul" gap={2} width="100%" className="min-w-0">
        {items.map((item) => (
          <HStack
            key={item.label}
            as="li"
            gap={3}
            align="start"
            width="100%"
            className="min-w-0"
          >
            {/*
              A fixed column so the labels line up whatever the marks say. The
              register's own grid is `2.5rem`; `w-8` is the token-scale step
              that lands nearest at this type size, and the mark is centred in
              it rather than left-aligned so `[x]` and `[ ]` occupy the same
              visual slot.
            */}
            <Text
              aria-hidden
              type="code"
              size="sm"
              color={item.done ? "accent" : "secondary"}
              textWrap="nowrap"
              className="w-8 shrink-0"
            >
              {item.done ? "[x]" : "[ ]"}
            </Text>
            <VStack gap={1} className="min-w-0">
              <Text type="code" size="sm" color={item.done ? "primary" : "secondary"}>
                {item.label}
              </Text>
              {item.note ? (
                <Text type="supporting" size="sm" as="p">
                  {item.note}
                </Text>
              ) : null}
            </VStack>
          </HStack>
        ))}
      </VStack>

      {/*
        The count, for a reader who is not looking at the marks. Upstream puts
        the same sentence in an `sr-only` span; here it is `Provenance`-sized
        supporting text and visible, because on this page the ratio is the
        headline — "two of six" is the answer to why the screen has so few
        controls, and burying it in the accessibility tree would tell only the
        readers who were not confused.
      */}
      <Text type="supporting" size="sm" hasTabularNumbers>
        {done} of {items.length} in place
      </Text>
    </Frame>
  );
}

/* ── Meter ─────────────────────────────────────────────────────────────── */

/**
 * One fill from 0 to 1 — `mdx-graphs.kshv.me/docs/graph-meter`.
 *
 * `[ ========------ ] 57%`. Fourteen ticks by default, the same as upstream,
 * because the number is legible as a count at that width and the bar still
 * reads as a bar.
 *
 * A meter and not a bullet: this draws one quantity against its own maximum,
 * which is what a spend cap is. A bullet chart draws an actual against a
 * separate target and would be the right graph if the policy had a budget as
 * well as a limit.
 */
export function GraphMeter({
  title,
  value,
  ticks = 14,
  caption,
}: {
  title: string;
  /** 0 to 1. Values outside are clamped rather than refused. */
  value: number;
  ticks?: number;
  caption?: string;
}) {
  const clamped = Math.min(1, Math.max(0, value));
  const filled = Math.round(clamped * ticks);

  return (
    <Frame surface="body" title={title}>
      <HStack gap={3} align="center" width="100%" className="min-w-0">
        <Text aria-hidden type="code" size="sm" color="secondary">
          [
        </Text>
        <HStack gap={0} align="center" width="100%" className="min-w-0 flex-1">
          {Array.from({ length: ticks }, (_, index) => (
            <Text
              key={index}
              aria-hidden
              type="code"
              size="sm"
              color={index < filled ? "accent" : "secondary"}
              justify="center"
              className="min-w-0 flex-1"
            >
              {index < filled ? "=" : "-"}
            </Text>
          ))}
        </HStack>
        <Text aria-hidden type="code" size="sm" color="secondary">
          ]
        </Text>
        {/*
          Tabular figures and a fixed column, so the number does not shuffle
          the closing bracket sideways as the fill changes — the specific
          illegibility `Provenance` calls out for read times, and the same fix.
        */}
        <Text
          type="code"
          size="sm"
          color="accent"
          hasTabularNumbers
          justify="end"
          textWrap="nowrap"
          className="w-12 shrink-0"
        >
          {Math.round(clamped * 100)}%
        </Text>
      </HStack>
      {caption ? (
        <Text type="supporting" size="sm" as="p">
          {caption}
        </Text>
      ) : null}
    </Frame>
  );
}

/* ── Tree ──────────────────────────────────────────────────────────────── */

export interface TreeNode {
  label: string;
  /** A value or a note for the right of the row. */
  meta?: string;
  accent?: boolean;
  children?: TreeNode[];
}

interface TreeRow {
  key: string;
  branch: string;
  label: string;
  meta?: string;
  accent?: boolean;
}

/**
 * Flatten to rows carrying their own branch prefix.
 *
 * Ported from upstream unchanged, because the prefixes are the drawing: a row
 * knows whether it is the last of its siblings (`└─` rather than `├─`) and
 * every level above it contributes `│  ` or three spaces depending on whether
 * *that* level continued. Recomputing it per row from a depth number is the
 * version that draws a trailing `│` under a finished branch.
 *
 * A single root gets no prefix at all — a lone `└─` above everything is a
 * branch from nothing.
 */
function flattenTree(
  nodes: TreeNode[],
  prefix = "",
  trail = "root",
  isRoot = true,
): TreeRow[] {
  const singleRoot = isRoot && nodes.length === 1;

  return nodes.flatMap((node, index) => {
    const last = index === nodes.length - 1;
    const key = `${trail}/${node.label}-${index}`;
    const childPrefix = singleRoot ? "" : prefix + (last ? "   " : "│  ");

    return [
      {
        key,
        branch: singleRoot ? "" : prefix + (last ? "└─ " : "├─ "),
        label: node.label,
        meta: node.meta,
        accent: node.accent,
      },
      ...(node.children ? flattenTree(node.children, childPrefix, key, false) : []),
    ];
  });
}

/**
 * Nesting — `mdx-graphs.kshv.me/docs/graph-tree`.
 *
 * The branch characters are part of the label's own text run rather than a
 * column beside it, which is what keeps them aligned: they are monospace
 * glyphs measured by the same font as everything after them, so a deep level
 * cannot drift out of true against a shallow one.
 */
export function GraphTree({
  title,
  nodes,
}: {
  title: string;
  nodes: TreeNode[];
}) {
  return (
    <Frame surface="body" title={title}>
      <VStack gap={1} width="100%" className="min-w-0">
        {flattenTree(nodes).map((row) => (
          <HStack
            key={row.key}
            gap={3}
            align="start"
            justify="between"
            width="100%"
            className="min-w-0"
          >
            <Text
              type="code"
              size="2xs"
              color={row.accent ? "accent" : "primary"}
              wordBreak="break-all"
            >
              <Text as="span" type="code" size="2xs" color="secondary">
                {row.branch}
              </Text>
              {row.label}
            </Text>
            {row.meta ? (
              <Text
                type="code"
                size="2xs"
                color="secondary"
                hasTabularNumbers
                textWrap="nowrap"
              >
                {row.meta}
              </Text>
            ) : null}
          </HStack>
        ))}
      </VStack>
    </Frame>
  );
}
