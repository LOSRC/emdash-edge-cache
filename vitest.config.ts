import { defineConfig } from 'vitest/config'

// `cloudflare:workers` exists only inside workerd. Tests run in Node against a stand-in that
// provides the one thing the package takes from it: the `WorkerEntrypoint` base class.
export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': new URL('./test/cloudflare-workers.ts', import.meta.url).pathname,
    },
  },
  test: { include: ['src/**/*.test.ts', 'test/**/*.test.ts'] },
})
