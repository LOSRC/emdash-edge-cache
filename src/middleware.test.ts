import { describe, expect, it } from 'vitest'

import { createEdgeCacheMiddleware } from './middleware.ts'
import { DEFAULT_ROUTE_RULES, defineCacheConfig } from './rules.ts'

const config = defineCacheConfig({
  routeRules: DEFAULT_ROUTE_RULES,
  neverCached: { prefixes: ['/api'], paths: ['/feed.xml'] },
})

interface Options {
  cookies?: Record<string, string>
  user?: unknown
  cache?: boolean
}

/** Runs the middleware against a fake context and records what happened, in order. */
async function run(url: string, respond: () => Response, options: Options = {}) {
  const events: string[] = []
  const context = {
    url: new URL(url),
    cookies: {
      get: (name: string) => {
        const value = options.cookies?.[name]
        return value === undefined ? undefined : { value }
      },
    },
    cache: options.cache === false ? undefined : { set: () => events.push('cache.set(false)') },
    locals: { user: options.user },
  }
  const response = await createEdgeCacheMiddleware(config)(context, async () => {
    events.push('next')
    return respond()
  })
  return { response, events }
}

const page = () =>
  new Response('page', { headers: { 'Cache-Control': 'public, max-age=0, must-revalidate' } })

const NO_STORE = 'private, no-store'
const OFF_AROUND_NEXT = ['cache.set(false)', 'next', 'cache.set(false)']

describe('a public page', () => {
  it('is left alone: cache on, header untouched', async () => {
    const { response, events } = await run('https://example.com/about', page)
    expect(events).toEqual(['next'])
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate')
    expect(await response.text()).toBe('page')
  })

  it('returns the very response the route made', async () => {
    const made = page()
    const { response } = await run('https://example.com/about', () => made)
    expect(response).toBe(made)
  })

  it('keeps tracking parameters from making it private', async () => {
    const { events } = await run('https://example.com/about?utm_source=x', page)
    expect(events).toEqual(['next'])
  })
})

describe('private renders', () => {
  it('treats any ?_preview as private, valid token or not, even without a value', async () => {
    for (const query of ['?_preview=abc', '?_preview=', '?_preview']) {
      const { response, events } = await run(`https://example.com/about${query}`, page)
      expect(events).toEqual(OFF_AROUND_NEXT)
      expect(response.headers.get('Cache-Control')).toBe(NO_STORE)
    }
  })

  it('treats ?_edit as private', async () => {
    const { response, events } = await run('https://example.com/about?_edit', page)
    expect(events).toEqual(OFF_AROUND_NEXT)
    expect(response.headers.get('Cache-Control')).toBe(NO_STORE)
  })

  it('treats the edit mode cookie as private', async () => {
    const { response, events } = await run('https://example.com/about', page, {
      cookies: { 'emdash-edit-mode': 'true' },
    })
    expect(events).toEqual(OFF_AROUND_NEXT)
    expect(response.headers.get('Cache-Control')).toBe(NO_STORE)
  })

  it('ignores the edit mode cookie when it is not "true"', async () => {
    const { events } = await run('https://example.com/about', page, {
      cookies: { 'emdash-edit-mode': 'false' },
    })
    expect(events).toEqual(['next'])
  })

  it('treats the admin as private', async () => {
    const { response, events } = await run('https://example.com/_emdash/admin/content', page)
    expect(events).toEqual(OFF_AROUND_NEXT)
    expect(response.headers.get('Cache-Control')).toBe(NO_STORE)
  })

  it('keeps a private response’s status, body and other headers', async () => {
    const { response } = await run(
      'https://example.com/about?_edit',
      () => new Response('draft', { status: 200, statusText: 'Fine', headers: { 'X-One': '1' } }),
    )
    expect(response.status).toBe(200)
    expect(response.statusText).toBe('Fine')
    expect(response.headers.get('X-One')).toBe('1')
    expect(await response.text()).toBe('draft')
  })

  it('copes with a response whose headers are immutable', async () => {
    const { response } = await run('https://example.com/about?_edit', () =>
      Response.redirect('https://example.com/other', 302),
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('Cache-Control')).toBe(NO_STORE)
  })
})

describe('signed-in visitors', () => {
  it('makes a page private for a signed-in user', async () => {
    const { response, events } = await run('https://example.com/about', page, {
      user: { id: 'u1' },
    })
    expect(events).toEqual(['next', 'cache.set(false)'])
    expect(response.headers.get('Cache-Control')).toBe(NO_STORE)
  })

  it('does not count a user under /_emdash, whose routes manage their own headers', async () => {
    const media = () =>
      new Response('img', { headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } })
    const { response } = await run('https://example.com/_emdash/api/media/file/a.jpg', media, {
      user: { id: 'u1' },
    })
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
  })
})

describe('never-cached paths', () => {
  it.each(['/_image', '/_emdash', '/_emdash/api/x', '/api', '/api/thing', '/feed.xml'])(
    '%s is switched off before and after the route',
    async (path) => {
      const { events } = await run(`https://example.com${path}`, page)
      expect(events).toEqual(OFF_AROUND_NEXT)
    },
  )

  it.each(['/robots.txt', '/sitemap.xml', '/sitemap-posts.xml'])(
    '%s, which EmDash serves without cache tags, is switched off',
    async (path) => {
      const { events } = await run(`https://example.com${path}`, page)
      expect(events).toEqual(OFF_AROUND_NEXT)
    },
  )

  it('does not touch a path that only looks like a never-cached prefix', async () => {
    const { events } = await run('https://example.com/apiary', page)
    expect(events).toEqual(['next'])
  })

  it('leaves a 200 header alone when the path is only never-cached', async () => {
    const { response } = await run('https://example.com/api/thing', page)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate')
  })

  it('keeps a media file’s own lifetime header, but not in the edge cache', async () => {
    const immutable = () =>
      new Response('img', { headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } })
    const { response, events } = await run(
      'https://example.com/_emdash/api/media/file/a.jpg',
      immutable,
    )
    expect(events).toEqual(OFF_AROUND_NEXT)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
  })

  it('stops a /[slug] rule from caching /_image', async () => {
    const withDefaults = createEdgeCacheMiddleware(
      defineCacheConfig({ routeRules: DEFAULT_ROUTE_RULES }),
    )
    const events: string[] = []
    await withDefaults(
      {
        url: new URL('https://example.com/_image'),
        cookies: { get: () => undefined },
        cache: { set: () => events.push('cache.set(false)') },
      },
      async () => {
        events.push('next')
        return new Response('img')
      },
    )
    expect(events).toEqual(OFF_AROUND_NEXT)
  })
})

describe('statuses', () => {
  it.each([301, 302, 404, 500])('%i is kept out of the edge and browsers', async (status) => {
    const { response, events } = await run(
      'https://example.com/about',
      () => new Response(null, { status, headers: { Location: 'https://example.com/x' } }),
    )
    expect(events).toEqual(['next', 'cache.set(false)'])
    expect(response.status).toBe(status)
    expect(response.headers.get('Cache-Control')).toBe(NO_STORE)
    expect(response.headers.get('Location')).toBe('https://example.com/x')
  })

  it('overrides a lifetime the route gave a 404', async () => {
    const { response } = await run(
      'https://example.com/missing',
      () =>
        new Response('nope', { status: 404, headers: { 'Cache-Control': 'public, max-age=60' } }),
    )
    expect(response.headers.get('Cache-Control')).toBe(NO_STORE)
    expect(await response.text()).toBe('nope')
  })

  it('keeps a 304 out of the edge but leaves its headers as they were', async () => {
    const notModified = new Response(null, {
      status: 304,
      headers: { 'Cache-Control': 'public, max-age=0, must-revalidate' },
    })
    const { response, events } = await run('https://example.com/about', () => notModified)
    expect(events).toEqual(['next', 'cache.set(false)'])
    expect(response).toBe(notModified)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate')
  })
})

describe('without a cache provider', () => {
  it('does not throw, and still sets the header for what must not be kept', async () => {
    const { response } = await run('https://example.com/about?_edit', page, { cache: false })
    expect(response.headers.get('Cache-Control')).toBe(NO_STORE)
    const missing = await run('https://example.com/x', () => new Response('', { status: 404 }), {
      cache: false,
    })
    expect(missing.response.headers.get('Cache-Control')).toBe(NO_STORE)
  })

  it('passes a public page through', async () => {
    const { response } = await run('https://example.com/about', page, { cache: false })
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate')
  })
})
