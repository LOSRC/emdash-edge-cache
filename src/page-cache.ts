/**
 * How a route tells the cache about the page it renders: an editor's preview is never cached;
 * otherwise the page carries the cache tags of everything it read, EmDash purges them when editors
 * publish, and browsers revalidate while the edge keeps the page for its route rule's lifetime.
 *
 * Every tag must be passed to `setPageCache` by the route itself: Astro sends the headers
 * (`Cache-Tag` among them) when the route returns, and the body streams after, so a component that
 * adds a tag while it draws is too late. A page that reads menus or site settings must pass those
 * helpers' `cacheHint`, so that EmDash's purges on a menu or settings edit (`emdash:menu:<name>`,
 * `emdash:settings`) reach it.
 *
 * A route that neither calls this nor sets `no-store` itself is not safe: when a route rule covers
 * its path the edge keeps whatever it answers, for the rule's lifetime, with nothing to purge it.
 */
import { NO_VARY_SEARCH } from './tracking.ts'

/** Browsers revalidate; the edge keeps the page for its route rule's lifetime. */
export const PUBLIC_CACHE_CONTROL = 'public, max-age=0, must-revalidate'

/** For anything that must not be kept by a browser or a shared cache. */
export const PRIVATE_NO_STORE = 'private, no-store'

/** EmDash's cache hint, structurally: what a content or menu helper returns as `cacheHint`. */
export interface CacheHint {
  tags?: string[]
  lastModified?: Date
}

/**
 * What `setPageCache` needs: the route cache and the response whose headers it sets. A page has
 * both on `Astro`; an endpoint builds its own response and passes `{ cache: context.cache,
 * response }`. `cache` is absent when no provider is configured (development).
 */
export interface CacheTarget {
  cache?: { set(value: CacheHint | false): void }
  response: { headers: Headers }
}

export interface PageCacheOptions {
  /** The cache hints of everything the page read. */
  hints?: readonly CacheHint[]
  /** True for an editor's preview, whether or not EmDash found the token valid. */
  isPreview?: boolean
}

export function setPageCache(
  target: CacheTarget,
  { hints = [], isPreview = false }: PageCacheOptions = {},
): void {
  const { cache, response } = target
  if (isPreview) {
    cache?.set(false)
    response.headers.set('Cache-Control', PRIVATE_NO_STORE)
    return
  }
  for (const hint of hints) cache?.set(hint)
  response.headers.set('Cache-Control', PUBLIC_CACHE_CONTROL)
  // The gateway drops these before the cache; browsers may share a cached page across them too.
  response.headers.set('No-Vary-Search', NO_VARY_SEARCH)
}
