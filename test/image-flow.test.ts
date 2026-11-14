import { beforeEach, describe, expect, it } from 'vitest'

import { throughGateway } from '../src/gateway.ts'
import { IMAGE_BROWSER_CACHE } from '../src/image-cache.ts'
import { createEdgeCacheMiddleware } from '../src/middleware.ts'
import { DEFAULT_ROUTE_RULES, defineCacheConfig, type RouteRule } from '../src/rules.ts'
import { withEdgeRules } from '../src/site.ts'

/**
 * The whole path of a request, with the real middleware, `withEdgeRules` and gateway and a fake
 * adapter in between: Astro's cache provider seeds the matched route rule, the middleware may
 * clear it with `cache.set(false)`, and once the chain has returned the provider writes the CDN
 * header (`no-store` when the cache was cleared or no rule matched).
 */
const CDN = 'Cloudflare-CDN-Cache-Control'
const EMDASH_IMAGE_HEADER = 'public, max-age=0, must-revalidate'
const middleware = createEdgeCacheMiddleware(defineCacheConfig({ routeRules: DEFAULT_ROUTE_RULES }))

const ruleFor = (pathname: string): RouteRule | undefined =>
  pathname === '/' ? DEFAULT_ROUTE_RULES['/'] : /^\/[^/]+$/.test(pathname)
    ? DEFAULT_ROUTE_RULES['/[slug]']
    : undefined

/** What the route answers: EmDash's resized images, a missing page, and published pages. */
function route(url: URL, status: number): Response {
  if (url.pathname === '/_image') {
    return new Response(status === 200 ? 'image' : 'error', {
      status,
      headers: { 'Cache-Control': EMDASH_IMAGE_HEADER },
    })
  }
  return new Response(status === 404 ? 'not found' : 'page', {
    status,
    headers: { 'Cache-Control': 'public, max-age=0, must-revalidate' },
  })
}

let siteSaw: URL[]
let siteAnswered: Response | undefined

/** `Site.fetch`: the chain behind the cache. The status is chosen by the test through the URL. */
const site = {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    siteSaw.push(url)
    const status = Number(url.searchParams.get('status') ?? 200)
    let cacheCleared = false
    const context = {
      url,
      cookies: { get: () => undefined },
      cache: {
        set(value: false) {
          if (value === false) cacheCleared = true
        },
      },
    }
    const response = await middleware(context, async () => route(url, status))

    // The provider writes its header after the whole chain has returned.
    const rule = ruleFor(url.pathname)
    const edge =
      cacheCleared || !rule
        ? 'no-store'
        : `public, max-age=${rule.maxAge}, stale-while-revalidate=${rule.swr}`
    const adapted = new Response(response.body, response)
    adapted.headers.set(CDN, edge)

    siteAnswered = withEdgeRules(adapted, url)
    return siteAnswered
  },
}

const get = (path: string) => throughGateway(new Request(`https://example.com${path}`), site)

beforeEach(() => {
  siteSaw = []
  siteAnswered = undefined
})

describe('a resized image', () => {
  it('is kept at the edge for an hour and by browsers for a day', async () => {
    const response = await get('/_image?href=%2Fmedia%2Fa.jpg&w=640')
    expect(siteAnswered?.headers.get(CDN)).toBe('public, max-age=3600')
    expect(response.headers.get('Cache-Control')).toBe(IMAGE_BROWSER_CACHE)
  })

  it('leaves the browser lifetime off what the cache stores', async () => {
    await get('/_image?href=%2Fmedia%2Fa.jpg&w=640')
    expect(siteAnswered?.headers.get('Cache-Control')).toBe(EMDASH_IMAGE_HEADER)
  })

  it('is not kept at the edge, nor given a browser lifetime, when it fails', async () => {
    const response = await get('/_image?href=%2Fmedia%2Fa.jpg&status=500')
    expect(siteAnswered?.headers.get(CDN)).toBe('no-store')
    expect(response.status).toBe(500)
    expect(response.headers.get('Cache-Control')).not.toBe(IMAGE_BROWSER_CACHE)
  })
})

describe('a page', () => {
  it('is kept for its route rule, and for a week if the Worker fails', async () => {
    await get('/about')
    expect(siteAnswered?.headers.get(CDN)).toBe(
      'public, max-age=86400, stale-while-revalidate=604800, stale-if-error=604800',
    )
  })

  it('is kept for the listing rule at the root', async () => {
    await get('/')
    expect(siteAnswered?.headers.get(CDN)).toBe(
      'public, max-age=600, stale-while-revalidate=604800, stale-if-error=604800',
    )
  })

  it('is asked of the site without its tracking parameters', async () => {
    await get('/about')
    await get('/about?utm_source=x')
    expect(siteSaw.map((url) => url.href)).toEqual([
      'https://example.com/about',
      'https://example.com/about',
    ])
  })

  it('is not kept, nor by browsers, when it is missing', async () => {
    const response = await get('/missing?status=404')
    expect(siteAnswered?.headers.get(CDN)).toBe('no-store')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })
})

describe('/robots.txt', () => {
  it('is not kept at the edge, though `/[slug]` matches it', async () => {
    await get('/robots.txt')
    expect(siteAnswered?.headers.get(CDN)).toBe('no-store')
  })
})
