import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30000,
    // Each integration file runs a real tick server with timing gates. Running
    // fault-injection servers beside the traffic test measures shared-host contention.
    fileParallelism: false,
  },
});
