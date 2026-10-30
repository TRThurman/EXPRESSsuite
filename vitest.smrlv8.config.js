import { defineConfig } from "vitest/config";

// The published ISO 10303 SMRL v8 EXPRESS schemas as a regression corpus
// (test-fixtures/smrlv8, baselines in test-fixtures/smrlv8-baseline).
// Each file builds a workspace of a thousand schemas or a hundred long forms,
// so files run one at a time in a worker with a 6 GB heap.
export default defineConfig({
  test: {
    include: ["src/test/smrlv8-*.test.ts"],
    reporters: ["verbose"],
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: {
        execArgv: ["--max-old-space-size=6144"],
      },
    },
  },
});
