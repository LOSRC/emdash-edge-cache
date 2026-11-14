/**
 * The package root: everything a site's config, middleware and routes use. Safe to import in Node
 * (`astro.config.mjs` reads the route rules at build time): nothing here touches
 * `cloudflare:workers`. The Worker's entrypoints are in `@losrc/emdash-edge-cache/worker`.
 */
export { PACKAGE_VERSION } from './version.ts'

export {
  ALWAYS_NEVER_CACHED_PATHS,
  ALWAYS_NEVER_CACHED_PREFIXES,
  DAY,
  DEFAULT_ROUTE_RULES,
  DETAIL,
  LISTING,
  STALE_IF_ERROR,
  WEEK,
  defineCacheConfig,
  isNeverCached,
  under,
} from './rules.ts'
export type { EdgeCacheConfig, NormalisedEdgeCacheConfig, RouteRule } from './rules.ts'

export { createEdgeCacheMiddleware } from './middleware.ts'
export type { EdgeCacheContext } from './middleware.ts'

export { PRIVATE_NO_STORE, PUBLIC_CACHE_CONTROL, setPageCache } from './page-cache.ts'
export type { CacheHint, CacheTarget, PageCacheOptions } from './page-cache.ts'

export { NO_VARY_SEARCH, withTrackingParamsOf, withoutTrackingParams } from './tracking.ts'
export { isWorkersDev, withNoindexOnWorkersDev } from './noindex.ts'
export {
  IMAGE_BROWSER_CACHE,
  IMAGE_EDGE_CACHE,
  IMAGE_ENDPOINT,
  isImageEndpoint,
  withImageBrowserCache,
  withImageEdgeCache,
} from './image-cache.ts'
