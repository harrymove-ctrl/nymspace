/**
 * The routing model, pinned on measurement rather than on preference.
 *
 * The same rule as `RANKING_MODEL` in `@nymspace/graph`: an environment
 * variable selecting the model would let a deploy change what the tests were
 * written against, and a routing model is only as good as the selections
 * someone has actually watched it make.
 *
 * `pnpm --filter @nymspace/adk measure:routing`, in
 * `evidence/routing-models.json`. Two questions against a fleet of three — one
 * that has to reach the whole fleet, one that has to reach a specific agent —
 * five times each:
 *
 *   model                   correct  answered   median      range   misses are
 *   gemini-3.5-flash-lite      7/10      7/10   6738ms   3.7-9.0s   empty turns
 *   gemini-3.6-flash           6/10      6/10   4426ms   3.2-6.0s   429s
 *
 * and, from the first survey of the field at three attempts each:
 *
 *   gemini-2.5-flash            4/6       4/6   1800ms              empty turns
 *   gemini-2.5-flash-lite       0/6       0/6        —              404 on this key
 *   gemini-3.1-flash-lite       3/6       6/6    814ms              wrong agent, confidently
 *
 * `gemini-3.5-flash-lite` is the pin, on the shape of the failures rather than
 * the count.
 *
 * `gemini-3.1-flash-lite` answered every time and sent half of them to the
 * wrong agent — a lens drawn for an agent nobody asked about, which is the one
 * outcome this console must not produce. `gemini-3.6-flash` was right whenever
 * it answered and spent four of ten attempts on 429s, which is this key's
 * quota rather than the model's judgement, and is the same wall Gate E hit
 * with the newer flash models on the ranking step. `gemini-3.5-flash-lite`
 * misses by saying nothing, which lands on the unanswered state that already
 * exists and is exactly what the operator would have got before this stage was
 * built. Silence is a recoverable failure; confident misdirection is not, and
 * a 429 is not a property of the model at all.
 *
 * Seven placements in ten on a single attempt is the honest number to hold in
 * mind, and `router.ts` spends one retry on an empty turn to move it: two of
 * four empty turns placed on a second ask, taking the same twelve-question run
 * from seven to nine. Three questions in ten still get the list of
 * suggestions — against ten in ten before this stage existed.
 *
 * Re-measure before moving this. The first run of that script reported a
 * 720ms median for this same model and a survey taken ten minutes later put it
 * at 6.7 seconds; a budget pinned on the first one timed out five of seven
 * live calls, which is how `ROUTING_TIMEOUT_MS` below got its value.
 */
export const ROUTING_MODEL = "gemini-3.5-flash-lite";

/**
 * How long the console will wait for a routing decision.
 *
 * Ten seconds, against a measured median of 6.7s and a worst observed call of
 * 9.0s. That is a long time to watch a screen, and it is the right trade here
 * for one reason: the matcher answers every question it recognises with no
 * model call at all, so this budget is only ever spent on a question that
 * would otherwise have been refused outright. Waiting nine seconds for an
 * answer beats waiting none for a list of suggestions.
 *
 * It expires into the unanswered state rather than into a retry. A second
 * attempt would double the wait for the case that is already the slowest.
 *
 * The first version of this file said four seconds, derived from a
 * measurement window that turned out to be unrepresentative. Gate F caught it:
 * five of seven live calls timed out, including the injection and off-topic
 * assertions, which then "passed" for the wrong reason. Do not lower this
 * without a run of `measure:routing` behind it.
 */
export const ROUTING_TIMEOUT_MS = 10_000;
