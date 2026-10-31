import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['engine/src/perf.test.ts'],
    /**
     * The perf assertions are load-sensitive, so they only run when this config
     * asks for them. Setting PERF here, rather than on the command line, works
     * the same on macOS and Windows.
     */
    env: { PERF: '1' },
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
