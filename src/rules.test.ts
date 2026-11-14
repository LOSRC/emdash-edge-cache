import { describe, expect, it } from 'vitest'

import * as lifetimes from './lifetimes.ts'
import {
  ALWAYS_NEVER_CACHED_PATHS,
  ALWAYS_NEVER_CACHED_PREFIXES,
  DAY,
  DEFAULT_ROUTE_RULES,
  DETAIL,
  defineCacheConfig,
  isNeverCached,
  LISTING,
  STALE_IF_ERROR,
  under,
  WEEK,
} from './rules.ts'

describe('re-exports', () => {
  it('hands on the lifetimes without redefining them', () => {
    expect(DAY).toBe(lifetimes.DAY)
    expect(WEEK).toBe(lifetimes.WEEK)
    expect(DETAIL).toBe(lifetimes.DETAIL)
    expect(LISTING).toBe(lifetimes.LISTING)
    expect(STALE_IF_ERROR).toBe(lifetimes.STALE_IF_ERROR)
  })
})

describe('DEFAULT_ROUTE_RULES', () => {
  it('gives the home page the listing lifetime and a single-segment page the detail one', () => {
    expect(DEFAULT_ROUTE_RULES['/']).toEqual(LISTING)
    expect(DEFAULT_ROUTE_RULES['/[slug]']).toEqual(DETAIL)
  })

  it('can be spread into a site’s own rules', () => {
    const config = defineCacheConfig({
      routeRules: { ...DEFAULT_ROUTE_RULES, '/news/[slug]': DETAIL },
    })
    expect(Object.keys(config.routeRules)).toEqual(['/', '/[slug]', '/news/[slug]'])
  })
})

describe('under', () => {
  it('matches the prefix and its sub-paths', () => {
    expect(under('/api', '/api')).toBe(true)
    expect(under('/api/x', '/api')).toBe(true)
    expect(under('/api/x/y', '/api')).toBe(true)
  })

  it('does not match a path that only starts with the same letters', () => {
    expect(under('/apiary', '/api')).toBe(false)
    expect(under('/', '/api')).toBe(false)
  })
})

describe('defineCacheConfig', () => {
  it('always keeps the image endpoint and EmDash out of the cache', () => {
    const config = defineCacheConfig({ routeRules: DEFAULT_ROUTE_RULES })
    expect(ALWAYS_NEVER_CACHED_PREFIXES).toEqual(['/_emdash', '/_image'])
    expect(config.neverCached.prefixes).toEqual(['/_emdash', '/_image'])
    expect(config.neverCached.paths).toEqual(['/robots.txt', '/sitemap.xml'])
  })

  it('adds a site’s prefixes and paths without duplicates', () => {
    const config = defineCacheConfig({
      routeRules: DEFAULT_ROUTE_RULES,
      neverCached: { prefixes: ['/api', '/_image', '/api'], paths: ['/robots.txt', '/humans.txt'] },
    })
    expect(config.neverCached.prefixes).toEqual(['/_emdash', '/_image', '/api'])
    expect(config.neverCached.paths).toEqual(['/robots.txt', '/sitemap.xml', '/humans.txt'])
  })

  it('returns a frozen config a site cannot loosen afterwards', () => {
    const config = defineCacheConfig({ routeRules: DEFAULT_ROUTE_RULES })
    expect(Object.isFrozen(config)).toBe(true)
    expect(Object.isFrozen(config.routeRules)).toBe(true)
    expect(Object.isFrozen(config.neverCached)).toBe(true)
    expect(Object.isFrozen(config.neverCached.prefixes)).toBe(true)
    expect(Object.isFrozen(config.neverCached.paths)).toBe(true)
  })

  it('does not change the object it was given', () => {
    const input = { routeRules: { '/': LISTING }, neverCached: { prefixes: ['/api'] } }
    defineCacheConfig(input)
    expect(input.neverCached.prefixes).toEqual(['/api'])
    expect(Object.isFrozen(input.routeRules)).toBe(false)
  })

  it('throws for a route rule that does not start with a slash', () => {
    expect(() => defineCacheConfig({ routeRules: { news: DETAIL } })).toThrow(
      /Route rule "news" must start with "\/"/,
    )
  })

  it('throws for a rule under a fixed never-cached prefix', () => {
    expect(() => defineCacheConfig({ routeRules: { '/_image': DETAIL } })).toThrow(
      /"\/_image".*never cached/,
    )
    expect(() => defineCacheConfig({ routeRules: { '/_emdash/x': DETAIL } })).toThrow(
      /"\/_emdash\/x".*never cached/,
    )
  })

  it('throws for a rule under a prefix the site made never-cached', () => {
    expect(() =>
      defineCacheConfig({
        routeRules: { '/api/[x]': DETAIL },
        neverCached: { prefixes: ['/api'] },
      }),
    ).toThrow(/"\/api\/\[x\]".*never cached/)
  })

  it('allows a rule whose leading segment is a parameter, which matches by shape', () => {
    expect(() => defineCacheConfig({ routeRules: { '/[slug]': DETAIL } })).not.toThrow()
  })

  it('allows a rule that only starts with the same letters as a never-cached prefix', () => {
    expect(() =>
      defineCacheConfig({
        routeRules: { '/apiary/[x]': DETAIL },
        neverCached: { prefixes: ['/api'] },
      }),
    ).not.toThrow()
  })

  it('throws for a rule on one of EmDash’s built-in untagged routes', () => {
    const keys = ['/robots.txt', '/sitemap.xml', '/sitemap-[collection].xml', '/sitemap-posts.xml']
    for (const key of keys) {
      expect(() => defineCacheConfig({ routeRules: { [key]: DETAIL } })).toThrow(
        new RegExp(`"${key.replace(/[[\]]/g, '\\$&').replace('.', '\\.')}".*no cache tags`),
      )
    }
  })

  it('throws for a site prefix that does not start with a slash', () => {
    expect(() =>
      defineCacheConfig({ routeRules: DEFAULT_ROUTE_RULES, neverCached: { prefixes: ['api'] } }),
    ).toThrow(/prefix "api" must start with "\/"/)
  })
})

describe('isNeverCached', () => {
  const config = defineCacheConfig({
    routeRules: DEFAULT_ROUTE_RULES,
    neverCached: { prefixes: ['/api', '/cart'], paths: ['/robots.txt'] },
  })

  it('is true for the fixed prefixes and their sub-paths', () => {
    expect(isNeverCached('/_image', config)).toBe(true)
    expect(isNeverCached('/_emdash', config)).toBe(true)
    expect(isNeverCached('/_emdash/api/media/file/a.jpg', config)).toBe(true)
  })

  it('is true for a site’s prefixes and exact paths', () => {
    expect(isNeverCached('/api/thing', config)).toBe(true)
    expect(isNeverCached('/cart', config)).toBe(true)
    expect(isNeverCached('/robots.txt', config)).toBe(true)
  })

  it('is false for ordinary pages, near misses and sub-paths of an exact path', () => {
    expect(isNeverCached('/', config)).toBe(false)
    expect(isNeverCached('/about', config)).toBe(false)
    expect(isNeverCached('/apiary', config)).toBe(false)
    expect(isNeverCached('/robots.txt/x', config)).toBe(false)
  })

  it('is true for EmDash’s robots.txt and sitemaps, which carry no cache tags', () => {
    expect(ALWAYS_NEVER_CACHED_PATHS).toEqual(['/robots.txt', '/sitemap.xml'])
    const bare = defineCacheConfig({ routeRules: DEFAULT_ROUTE_RULES })
    expect(isNeverCached('/robots.txt', bare)).toBe(true)
    expect(isNeverCached('/sitemap.xml', bare)).toBe(true)
    expect(isNeverCached('/sitemap-posts.xml', bare)).toBe(true)
  })

  it('is false for a page that only looks like a sitemap', () => {
    const bare = defineCacheConfig({ routeRules: DEFAULT_ROUTE_RULES })
    expect(isNeverCached('/sitemap', bare)).toBe(false)
    expect(isNeverCached('/sitemap-posts.html', bare)).toBe(false)
    expect(isNeverCached('/sitemap-a/b.xml', bare)).toBe(false)
    expect(isNeverCached('/robots.txt/x', bare)).toBe(false)
  })

  it('still keeps the fixed prefixes out of the cache for a config that was not normalised', () => {
    expect(isNeverCached('/_image', {})).toBe(true)
  })
})
