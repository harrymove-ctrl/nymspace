import "server-only";

/**
 * The console chat's routing stage.
 *
 * Guarded, because it holds a provider credential: `GEMINI_API_KEY` stays
 * behind the same `server-only` boundary as `GRAPH_API_KEY`, which is the
 * reason `@nymspace/graph`'s ranking step is a package rather than a route.
 *
 * What this package does *not* contain is any part of an answer. It selects a
 * read; `apps/api` performs it and renders it. See `router.ts`.
 */

export { createAdkRouter, type AdkRouterConfig, type ChatRouter, type ChatRouting, type RouterMiss, type RouterRequest } from "./router";
export { ROUTING_MODEL, ROUTING_TIMEOUT_MS } from "./model";
export {
  RECORD_KEY_NAMES,
  chatToolDeclarations,
  validateToolCall,
  type ChatToolCall,
  type ChatToolName,
  type FleetAgent,
  type RecordKeyName,
  type RouterFleet,
  type ToolCallRejection,
  type ToolCallResult,
} from "./tools";
