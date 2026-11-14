# @losrc/emdash-edge-cache

Edge caching for [EmDash](https://emdashcms.com) sites on Cloudflare Workers, as one fixed piece of
code every site uses instead of its own copy.

A site runs two entrypoints. The default export is an uncached **gateway**. Behind it is **`Site`**,
EmDash itself, with [Workers Cache](https://developers.cloudflare.com/workers/cache/) in front.
The gateway calls `ctx.exports.Site.fetch()`, and that call goes through the cache. So what the
gateway does to a request changes the cache key, and what it adds to a response is never stored.

What the package does:

| Concern | Behaviour | Where |
|---|---|---|
| Tracking parameters | Strips `utm_*`, `mc_*`, `fbclid` and `gclid` before the cache, so a tagged link shares the plain page's cache entry. Puts them back on a same-origin redirect `Location`, so analytics still sees them after the hop. | gateway |
| Pages | Route rules a site extends. Detail pages: a day. Listings: ten minutes. Both get a week of `stale-while-revalidate`, and `Site` adds a week of `stale-if-error`. | `cache-config.ts`, `Site` |
| Resized images (`/_image`) | Edge: a 200 for an hour, any error `no-store`. Browsers: `public, max-age=86400, stale-while-revalidate=604800`. | `Site` (edge), gateway (browser) |
| Only 200s are cached | Any other status is kept out of the edge cache. Redirects, 404s and errors also get `private, no-store`, because nothing would purge them. | middleware, and again in `Site` |
| Private renders | The admin, `?_preview`, the toolbar's `?_edit` render, the `emdash-edit-mode=true` cookie and signed-in visitors all get `private, no-store`, and stay out of the edge cache. | middleware |
| Never-cached paths | `/_emdash` and `/_image` (so no page rule can catch them), plus EmDash's untagged `/robots.txt`, `/sitemap.xml` and `/sitemap-*.xml`, plus the site's own. | middleware |
| `noindex` | `X-Robots-Tag: noindex, nofollow` on any `*.workers.dev` address, added after the cache so it never reaches a page cached for the real domain. | gateway |
| Crons | The gateway's `scheduled` calls `Site.runScheduled`, because purges reach only the cache of the entrypoint that makes them. EmDash's sweep runs there and is awaited. | gateway, `Site` |

## Install

Sites install it from GitHub, pinned by commit:

```sh
pnpm add github:LOSRC/emdash-edge-cache#<commit>
```

The package builds its `dist/` in a `prepare` script. pnpm 10 and later do not run a dependency's
build scripts unless you allow them, so allow this one in `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  '@losrc/emdash-edge-cache': true
```

Peer ranges, the versions this release was written against: `emdash` 1.2.0 to 1.5.x, `astro`
7.3.5 to 7.4.x, `@astrojs/cloudflare` 14.3.3 to 14.4.x. pnpm warns outside them. That is on
purpose: check the behaviour again before you widen a range.

## What a site writes

Five small pieces. Everything else is in the package.

### `src/cache-config.ts`: the site's own rules

```ts
import {
  DEFAULT_ROUTE_RULES,
  DETAIL,
  LISTING,
  defineCacheConfig,
} from '@losrc/emdash-edge-cache'

export default defineCacheConfig({
  routeRules: {
    // '/' (a listing) and '/[slug]' (a detail page).
    ...DEFAULT_ROUTE_RULES,
    '/blog': LISTING,
    '/blog/[slug]': DETAIL,
  },
  // Added to the fixed ones. A prefix covers itself and everything under it.
  neverCached: { prefixes: ['/api'], paths: [] },
})
```

`defineCacheConfig` throws if a rule names a never-cached path, for example `/_image`.

Route rules are Astro's (`maxAge`, `swr`, `tags`). Write a rule for every public route you want
cached. A route with no rule is not cached.

### `src/outer-middleware.ts`: the guard

```ts
import { createEdgeCacheMiddleware } from '@losrc/emdash-edge-cache'

import config from './cache-config.ts'

export const onRequest = createEdgeCacheMiddleware(config)
```

Register it as EmDash's *outer* middleware (below), not as `src/middleware.ts`. EmDash answers its
Redirects rows from its own middleware, ahead of a site's, so only an outer middleware sees those
answers.

### `astro.config.mjs`

```js
import cloudflare from '@astrojs/cloudflare'
import { cacheCloudflare } from '@astrojs/cloudflare/cache'
import { defineConfig } from 'astro/config'
import emdash from 'emdash/astro'

import cacheConfig from './src/cache-config.ts'

export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  cache: { provider: cacheCloudflare() },
  routeRules: cacheConfig.routeRules,
  integrations: [
    emdash({
      // ...database, storage, plugins
      // Pages are the same for everyone; editors get a script and an uncached `?_edit` render.
      toolbar: 'client',
      middleware: { outer: './src/outer-middleware.ts' },
    }),
  ],
})
```

### `src/worker.ts`

```ts
import handler, { createScheduledHandler } from '@emdash-cms/cloudflare/worker'
import { createGateway, createSite } from '@losrc/emdash-edge-cache/worker'

export { PluginBridge } from '@emdash-cms/cloudflare/worker'

/** The site, behind Workers Cache. Everything that purges runs here. */
export class Site extends createSite<Env>({ handler, scheduled: createScheduledHandler() }) {}

/** The uncached gateway in front of it. */
export default createGateway<Env>(handler)
```

Keep `export class Site` as a class declaration in `src/worker.ts`. `ctx.exports.Site` is found by
that export name. Whether a class assigned to a `const` (`export const Site = createSite(...)`)
is also found is unconfirmed, so don't rely on it.

A site with crons of its own (a nightly purge, say) passes `onCron`. It runs inside `Site`, so its
purges reach the cache:

```ts
import { cache } from 'cloudflare:workers'

export class Site extends createSite<Env>({
  handler,
  scheduled: createScheduledHandler(),
  // Every cron other than EmDash's '* * * * *'.
  async onCron({ cron }) {
    if (cron === '0 0 * * *') await cache.purge({ tags: ['events'] })
  },
}) {}
```

### `wrangler.jsonc`

```jsonc
{
  "main": "./src/worker.ts",
  // Read by @astrojs/cloudflare for its version Cache-Tag and ETag. Repeat it in every `env`:
  // bindings are not inherited.
  "version_metadata": { "binding": "CF_VERSION_METADATA" },
  "cache": { "enabled": true },
  "exports": {
    // The gateway: uncached, so what it adds never reaches the cache.
    "default": { "type": "worker", "cache": { "enabled": false } },
    // The site: cached.
    "Site": { "type": "worker", "cache": { "enabled": true } },
  },
  // EmDash's maintenance cron, forwarded by the gateway to Site.
  "triggers": { "crons": ["* * * * *"] },
}
```

Never set `cross_version_cache`. The Worker version is part of the cache key, so each deploy
starts with an empty cache, and stale pages from the old code go with it.

## In routes: `setPageCache`

Every public route tells the cache what it read. Astro sends the headers when the route returns
and streams the body after, so a component that adds a tag while it draws is too late. Pass every
tag from the route's frontmatter:

```astro
---
import { setPageCache } from '@losrc/emdash-edge-cache'
import { getEmDashEntry, getMenuWithCacheHint, getSiteSettingsWithCacheHint } from 'emdash'

const { entry, cacheHint, isPreview } = await getEmDashEntry('posts', Astro.params.slug!)
const menu = await getMenuWithCacheHint('primary')
const settings = await getSiteSettingsWithCacheHint()

setPageCache(Astro, { isPreview, hints: [cacheHint, menu.cacheHint, settings.cacheHint] })
---
```

EmDash purges a page's tags when an editor publishes. It also purges `emdash:menu:<name>` when a
menu's items change and `emdash:settings` when site settings change (seen in EmDash 1.2.0 to 1.5.0).
Those purges reach a page only if the route passed the menu's or settings' `cacheHint`, which
`getMenu` and `getSiteSettings` do not return: use the `...WithCacheHint` forms. A page that shows
the menu without its hint keeps the old menu until it expires.

`setPageCache` gives browsers `public, max-age=0, must-revalidate` (the edge keeps the page; the
browser asks each time) and a `No-Vary-Search` header for the tracking parameters.

## What stays in the site

Anything specific to one site: shop or other plugin tags, purge endpoints, key files, trailing-slash
redirects, nightly purges of particular tags, `public/_headers` for static files.

## Things to know

- **Purges reach only the purging entrypoint's cache.** EmDash's publish hooks run inside `Site`
  (admin writes go through the gateway to `Site.fetch`), and so do crons. Any code of your own
  that purges must run inside `Site` too. A purge from the gateway clears nothing.
- **Purges are rate-limited** (Free plan: 5 a minute, a burst of 25) and can fail silently.
- **A HIT never runs the Worker**, so nothing in `Site` or the middleware sees it.
- **The cache key ignores the hostname.** Two environments must never share a Worker.
- Adopting the gateway on a site that already caches changes the cache key (the entrypoint is
  part of it), so expect a cold cache once.

## For deploy tools

```ts
import { PACKAGE_VERSION } from '@losrc/emdash-edge-cache'
```

`PACKAGE_VERSION` is the installed version, the same as `package.json`'s (also exported as
`@losrc/emdash-edge-cache/package.json`). A tool can refuse a site below the version it requires.
The header values are exported too (`IMAGE_BROWSER_CACHE`, `IMAGE_EDGE_CACHE`,
`PUBLIC_CACHE_CONTROL`, `PRIVATE_NO_STORE`), so after-deploy checks compare against the same
strings.

## Develop

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Licence

MIT
