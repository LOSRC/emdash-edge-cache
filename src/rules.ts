/**
 * What the edge may keep, in one place: the route rules a site hands to Astro and the paths that
 * are never cached whatever a rule says. No Astro or Cloudflare imports, so `astro.config.mjs` can
 * read it.
 *
 * Astro's rules cannot say "never" (a rule needs a `maxAge`, and no rule means no caching), and a
 * rule such as `/[slug]` matches any single-segment path, `/_image` included. So the exclusions are
 * enforced by the middleware (middleware.ts), which switches the route cache off for them.
 */
import { DETAIL, LISTING, type RouteRule } from './lifetimes.ts'

export { DAY, DETAIL, LISTING, STALE_IF_ERROR, WEEK } from './lifetimes.ts'
export type { RouteRule } from './lifetimes.ts'

/**
 * The rules every EmDash site starts from: a listing at `/` and a detail page one segment down.
 * A site spreads this and adds its own routes.
 */
export const DEFAULT_ROUTE_RULES: Readonly<Record<string, RouteRule>> = Object.freeze({
  '/': LISTING,
  '/[slug]': DETAIL,
})

/**
 * Prefixes that are never cached, which a site cannot remove: EmDash's admin and API (private, or
 * serving files with a lifetime of their own) and the image endpoint (it has its own edge rule in
 * image-cache.ts, and no page rule may give it another).
 */
export const ALWAYS_NEVER_CACHED_PREFIXES: readonly string[] = ['/_emdash', '/_image']

/**
 * EmDash's own single-segment routes that carry no cache tags, so nothing would purge them after
 * an edit, and that the default `/[slug]` rule matches: `/robots.txt` (it answers `no-store` while
 * EmDash's staging setting is on, which must not be kept for a week) and the sitemap index. Its
 * per-collection sitemaps (`/sitemap-<collection>.xml`) are matched by `isSitemapShard`, and stay
 * never-cached unless the site serves a tagged sitemap of its own at that exact path and writes a
 * rule for it: a static route takes priority over EmDash's dynamic one, so that path is the
 * site's, not EmDash's.
 */
export const ALWAYS_NEVER_CACHED_PATHS: readonly string[] = ['/robots.txt', '/sitemap.xml']

/** `/sitemap-<anything>.xml`, one segment: EmDash's `/sitemap-[collection].xml`. */
const SITEMAP_SHARD = /^\/sitemap-[^/]+\.xml$/

function isSitemapShard(path: string): boolean {
  return SITEMAP_SHARD.test(path)
}

/** Whether a rule key is a pattern (`[param]` or `*`) rather than one literal path. */
function isPattern(key: string): boolean {
  return /[[\]*]/.test(key)
}

export interface EdgeCacheConfig {
  /** Route patterns in Astro's syntax. Tags are best set by each route, from what the page read. */
  routeRules: Record<string, RouteRule>
  neverCached?: {
    /** Added to the fixed prefixes: each matches itself and its sub-paths. */
    prefixes?: string[]
    /** Added to the fixed paths: exact paths a rule such as `/[slug]` would otherwise take. */
    paths?: string[]
  }
}

/** An `EdgeCacheConfig` after `defineCacheConfig`: complete and frozen. */
export interface NormalisedEdgeCacheConfig {
  readonly routeRules: Readonly<Record<string, RouteRule>>
  readonly neverCached: {
    readonly prefixes: readonly string[]
    readonly paths: readonly string[]
  }
}

/** True when the path is the prefix or one of its sub-paths (`/api`, `/api/x`, not `/apiary`). */
export function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/**
 * The part of a route pattern before its first parameter: `/api/[x]` gives `/api`, `/[slug]`
 * gives `/`. A pattern with a parameter first matches by shape, so it names no path to compare.
 */
function literalLead(pattern: string): string {
  const literal: string[] = []
  for (const segment of pattern.split('/').slice(1)) {
    if (isPattern(segment)) break
    literal.push(segment)
  }
  return `/${literal.join('/')}`
}

/**
 * Checks a site's config and fills in what it left out. Throws, naming the culprit, for a rule
 * that is not an absolute pattern or that sits under a never-cached prefix: the middleware would
 * switch it off, so the rule would be dead weight and the site is surely mistaken about it.
 */
export function defineCacheConfig(config: EdgeCacheConfig): NormalisedEdgeCacheConfig {
  const sitePrefixes = config.neverCached?.prefixes ?? []
  for (const prefix of sitePrefixes) {
    if (!prefix.startsWith('/')) {
      throw new Error(`Never-cached prefix "${prefix}" must start with "/"`)
    }
  }
  const prefixes = [...new Set([...ALWAYS_NEVER_CACHED_PREFIXES, ...sitePrefixes])]
  const sitePaths = config.neverCached?.paths ?? []

  for (const pattern of Object.keys(config.routeRules)) {
    if (!pattern.startsWith('/')) throw new Error(`Route rule "${pattern}" must start with "/"`)
    // A literal shard path is the site's own tagged sitemap; only the pattern is EmDash's route.
    if (
      ALWAYS_NEVER_CACHED_PATHS.includes(pattern) ||
      (isSitemapShard(pattern) && isPattern(pattern))
    ) {
      throw new Error(
        `Route rule "${pattern}" is one of EmDash's built-in routes, which has no cache tags ` +
          'and is never cached',
      )
    }
    if (sitePaths.includes(pattern)) {
      throw new Error(`Route rule "${pattern}" is also in neverCached.paths, which is never cached`)
    }
    const lead = literalLead(pattern)
    if (prefixes.some((prefix) => under(lead, prefix))) {
      throw new Error(`Route rule "${pattern}" is under a path that is never cached`)
    }
  }

  return Object.freeze({
    routeRules: Object.freeze({ ...config.routeRules }),
    neverCached: Object.freeze({
      prefixes: Object.freeze(prefixes),
      paths: Object.freeze([
        ...new Set([...ALWAYS_NEVER_CACHED_PATHS, ...sitePaths]),
      ]),
    }),
  })
}

/**
 * Whether a path is never cached, whatever route rule matched. The fixed prefixes and paths
 * always count, even for a config that was not run through `defineCacheConfig`. A sitemap shard
 * is never cached unless the config has a rule for that exact path (the site's own tagged sitemap).
 */
export function isNeverCached(
  pathname: string,
  config: {
    routeRules?: Readonly<Record<string, RouteRule>>
    neverCached?: { prefixes?: readonly string[]; paths?: readonly string[] }
  },
): boolean {
  const { prefixes = [], paths = [] } = config.neverCached ?? {}
  const ownShard = isSitemapShard(pathname) && Object.hasOwn(config.routeRules ?? {}, pathname)
  return (
    (isSitemapShard(pathname) && !ownShard) ||
    ALWAYS_NEVER_CACHED_PATHS.includes(pathname) ||
    paths.includes(pathname) ||
    ALWAYS_NEVER_CACHED_PREFIXES.some((prefix) => under(pathname, prefix)) ||
    prefixes.some((prefix) => under(pathname, prefix))
  )
}
