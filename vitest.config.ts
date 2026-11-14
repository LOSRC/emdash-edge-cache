import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

// `cloudflare:workers` exists only inside workerd. Tests run in Node against a stand-in that
// provides the one thing the package takes from it: the `WorkerEntrypoint` base class.
export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': fileURLToPath(new URL('./test/cloudflare-workers.ts', import.meta.url)),
    },
  },
  test: { include: ['src/**/*.test.ts', 'test/**/*.test.ts'] },
})
