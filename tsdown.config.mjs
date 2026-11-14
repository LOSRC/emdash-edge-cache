// Plain JavaScript on purpose: `prepare` runs this file when the package is installed from git, and
// pnpm does that inside its store, which can sit under a node_modules path. Node refuses to strip
// types from TypeScript there ("Stripping types is currently unsupported for files under
// node_modules"), so a tsdown.config.ts would fail the install.
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    worker: 'src/worker.ts',
  },
  format: 'esm',
  platform: 'neutral',
  dts: true,
  clean: true,
  // The Workers runtime provides this module; it is never bundled.
  deps: { neverBundle: ['cloudflare:workers'] },
});
