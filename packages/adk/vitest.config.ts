import { defineConfig } from "vitest/config";

/**
 * `server-only` exports a throwing module under every condition except
 * `react-server`, and it ships JavaScript, so it is externalised and needs
 * `externalConditions` as well as `conditions`. Same reasoning as
 * `apps/api/vitest.config.ts`.
 *
 * These tests reach no network and construct no runner: the tool contract is
 * the part worth pinning, and it is a pure function of a message and a fleet.
 * What the model does with the contract is asserted in `apps/api`, through an
 * injected router.
 */
const CONDITIONS = ["react-server", "import", "node", "default"];

export default defineConfig({
  ssr: {
    resolve: {
      conditions: CONDITIONS,
      externalConditions: CONDITIONS,
    },
  },
  test: {
    server: {
      deps: {
        inline: [/@nymspace\//],
      },
    },
  },
});
