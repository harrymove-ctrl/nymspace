/**
 * The routing model, pinned rather than configured.
 *
 * The same rule as `RANKING_MODEL` in `@nymspace/graph`, for the same reason:
 * an environment variable selecting the model would let a deploy change what
 * the tests were written against, and a routing model is only as good as the
 * selections someone has actually watched it make.
 *
 * `gemini-2.5-flash` is inherited from Gate E's measurements of the ranking
 * step, where it was the only model that answered three times out of three at
 * a usable latency — `gemini-3.8-flash` returned 429 on every attempt on this
 * key, and `gemini-flash-lite-latest` was fastest and disqualified for being
 * an alias that moves. This call is smaller than that one, so the numbers are
 * a ceiling rather than a prediction; design OQ3 holds the measurement of this
 * call specifically, and this constant moves when that lands.
 */
export const ROUTING_MODEL = "gemini-2.5-flash";

/**
 * How long the console will wait for a routing decision.
 *
 * Below the point where a person watching a demo concludes the page has hung.
 * The matcher answers the demo's own sentences with no model call at all, so
 * this budget is only ever spent on a question that would otherwise have been
 * refused outright — which is why it expires into the unanswered state rather
 * than into a retry.
 */
export const ROUTING_TIMEOUT_MS = 6_000;
