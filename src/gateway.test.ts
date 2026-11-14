import { describe, expect, it } from 'vitest'

import { createGateway, throughGateway } from './gateway.ts'
import { IMAGE_BROWSER_CACHE } from './image-cache.ts'

/** A stand-in for the cached `Site` entrypoint that records what it was asked for. */
function site(response: () => Response = () => new Response('<p>Hi</p>')) {
  const seen: Request[] = []
  return {
    seen,
    fetch: async (request: Request) => {
      seen.push(request)
      return response()
    },
  }
}

const BASE = 'https://example.com'

const redirect =
  (location: string, status = 301) =>
  () =>
    new Response(null, { status, headers: { Location: location } })

describe('throughGateway', () => {
  describe('the request the site sees', () => {
    it('passes an untagged request on as the very same object', async () => {
      const stub = site()
      const request = new Request(`${BASE}/about/?a=1`)
      await throughGateway(request, stub)
      expect(stub.seen).toEqual([request])
      expect(stub.seen[0]).toBe(request)
    })

    it('drops tracking parameters, so a tagged link shares the plain page’s entry', async () => {
      const stub = site()
      await throughGateway(
        new Request(
          `${BASE}/about/?utm_source=news&utm_medium=email&fbclid=1&gclid=2&mc_cid=3&mc_eid=4`,
        ),
        stub,
      )
      expect(stub.seen[0]!.url).toBe(`${BASE}/about/`)
    })

    it('keeps the parameters a page answers to, in order', async () => {
      const stub = site()
      await throughGateway(
        new Request(`${BASE}/about/?utm_campaign=x&_preview=token&a=1&utm_term=y`),
        stub,
      )
      expect(new URL(stub.seen[0]!.url).search).toBe('?_preview=token&a=1')
    })

    it('keeps the method and headers of a tagged HEAD request', async () => {
      const stub = site()
      await throughGateway(
        new Request(`${BASE}/about?utm_source=a`, { method: 'HEAD', headers: { 'X-Test': '1' } }),
        stub,
      )
      const [seen] = stub.seen
      expect(seen!.url).toBe(`${BASE}/about`)
      expect(seen!.method).toBe('HEAD')
      expect(seen!.headers.get('X-Test')).toBe('1')
    })

    it.each(['POST', 'PUT', 'DELETE'])(
      'leaves the tracking parameters on a %s, which is never cached',
      async (method) => {
        const stub = site()
        const request = new Request(`${BASE}/form?utm_source=a&b=1`, {
          method,
          headers: { 'X-Test': '1' },
          body: 'payload',
        })
        await throughGateway(request, stub)
        expect(stub.seen[0]).toBe(request)
        expect(stub.seen[0]!.url).toBe(`${BASE}/form?utm_source=a&b=1`)
      },
    )

    it('returns the site’s response', async () => {
      const response = await throughGateway(
        new Request(`${BASE}/old/`),
        site(() => new Response('gone', { status: 410 })),
      )
      expect(response.status).toBe(410)
      expect(await response.text()).toBe('gone')
    })
  })

  describe('a redirect the site answers', () => {
    const tagged = `${BASE}/old/?utm_source=news&a=1`

    it('gets the request’s tracking parameters back on a relative Location', async () => {
      const response = await throughGateway(new Request(tagged), site(redirect('/new/')))
      expect(response.status).toBe(301)
      expect(response.headers.get('Location')).toBe('/new/?utm_source=news')
    })

    it('gets them back on an absolute same-origin Location, which stays absolute', async () => {
      const response = await throughGateway(
        new Request(tagged),
        site(redirect(`${BASE}/new/?ref=a#top`, 302)),
      )
      expect(response.status).toBe(302)
      expect(response.headers.get('Location')).toBe(`${BASE}/new/?ref=a&utm_source=news#top`)
    })

    it('does not override a tag the target already carries', async () => {
      const response = await throughGateway(
        new Request(tagged),
        site(redirect('/new/?utm_source=other')),
      )
      expect(response.headers.get('Location')).toBe('/new/?utm_source=other')
    })

    it('resolves a relative Location against the original address', async () => {
      const response = await throughGateway(
        new Request(`${BASE}/docs/old/?utm_source=news`),
        site(redirect('../new/')),
      )
      expect(response.headers.get('Location')).toBe('/docs/new/?utm_source=news')
    })

    it('writes an absolute Location whole when its path would read as another host', async () => {
      const response = await throughGateway(
        new Request(tagged),
        site(redirect(`${BASE}//evil.example/x`)),
      )
      expect(response.headers.get('Location')).toBe(`${BASE}//evil.example/x?utm_source=news`)
    })

    it('writes a relative Location resolving to a // path whole, not as a bare path', async () => {
      const response = await throughGateway(
        new Request(tagged),
        site(redirect('/.//evil.example/x')),
      )
      expect(response.headers.get('Location')).toBe(`${BASE}//evil.example/x?utm_source=news`)
    })

    it('leaves a redirect to another origin alone', async () => {
      const location = 'https://other.example.org/page'
      const response = await throughGateway(new Request(tagged), site(redirect(location)))
      expect(response.headers.get('Location')).toBe(location)
    })

    it('leaves a redirect alone when the request had no tracking parameters', async () => {
      const original = new Response(null, { status: 301, headers: { Location: `${BASE}/new/` } })
      const response = await throughGateway(new Request(`${BASE}/old/?a=1`), site(() => original))
      expect(response).toBe(original)
      expect(response.headers.get('Location')).toBe(`${BASE}/new/`)
    })

    it('leaves a 304 alone', async () => {
      const original = new Response(null, { status: 304, headers: { Location: '/new/' } })
      const response = await throughGateway(new Request(tagged), site(() => original))
      expect(response.headers.get('Location')).toBe('/new/')
    })

    it('leaves a non-redirect with a Location header alone', async () => {
      const original = new Response('made', { status: 201, headers: { Location: '/things/1' } })
      const response = await throughGateway(new Request(tagged), site(() => original))
      expect(response.headers.get('Location')).toBe('/things/1')
    })

    it('leaves a redirect with no Location alone', async () => {
      const original = new Response(null, { status: 302 })
      const response = await throughGateway(new Request(tagged), site(() => original))
      expect(response.headers.get('Location')).toBeNull()
    })

    it('does not touch the response the site returned', async () => {
      const original = new Response(null, { status: 301, headers: { Location: '/new/' } })
      const response = await throughGateway(new Request(tagged), site(() => original))
      expect(response).not.toBe(original)
      expect(original.headers.get('Location')).toBe('/new/')
    })
  })

  describe('resized images', () => {
    const image = `${BASE}/_image?href=x&w=640`
    const emdash = () =>
      new Response('img', { headers: { 'Cache-Control': 'public, max-age=0, must-revalidate' } })

    it('get a browser lifetime after the site has answered', async () => {
      const response = await throughGateway(new Request(image), site(emdash))
      expect(response.headers.get('Cache-Control')).toBe(IMAGE_BROWSER_CACHE)
    })

    it('do not change the response the site returned (what the cache stores)', async () => {
      const original = emdash()
      await throughGateway(new Request(image), site(() => original))
      expect(original.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate')
    })
  })

  describe('noindex', () => {
    it('is added on a workers.dev address: pages, errors, redirects and assets', async () => {
      const base = 'https://my-site.example.workers.dev'
      const cases: [string, () => Response][] = [
        ['/about/', () => new Response('ok')],
        ['/nope/', () => new Response('missing', { status: 404 })],
        ['/old/', redirect('/about/')],
        ['/_astro/site.css', () => new Response('a{}')],
      ]
      for (const [path, response] of cases) {
        const result = await throughGateway(new Request(base + path), site(response))
        expect(result.headers.get('X-Robots-Tag'), path).toBe('noindex, nofollow')
      }
    })

    it('is not added on a custom domain', async () => {
      const response = await throughGateway(new Request(`${BASE}/`), site())
      expect(response.headers.get('X-Robots-Tag')).toBeNull()
    })

    it('is not added to the response the site returned (what the cache stores)', async () => {
      const original = new Response('ok')
      await throughGateway(
        new Request('https://my-site.example.workers.dev/'),
        site(() => original),
      )
      expect(original.headers.has('X-Robots-Tag')).toBe(false)
    })
  })
})

type IncomingRequest = Request<unknown, IncomingRequestCfProperties>

describe('createGateway', () => {
  /** A fake `ctx` whose `exports.Site` records what the gateway asks of it. */
  function context() {
    const calls: { fetched: Request[]; scheduled: [string, number][] } = {
      fetched: [],
      scheduled: [],
    }
    const Site = {
      fetch: async (request: Request) => {
        calls.fetched.push(request)
        return new Response('from site')
      },
      runScheduled: async (cron: string, scheduledTime: number) => {
        await Promise.resolve()
        calls.scheduled.push([cron, scheduledTime])
      },
    }
    return { calls, ctx: { exports: { Site } } as unknown as ExecutionContext }
  }

  it('sends fetch through the gateway to ctx.exports.Site', async () => {
    const { calls, ctx } = context()
    const handler = createGateway({})
    const response = await handler.fetch!(
      new Request(`${BASE}/about/?utm_source=news`) as IncomingRequest,
      {},
      ctx,
    )
    expect(await response.text()).toBe('from site')
    expect(calls.fetched.map((request) => request.url)).toEqual([`${BASE}/about/`])
  })

  it('hands a scheduled run to Site.runScheduled and waits for it', async () => {
    const { calls, ctx } = context()
    const handler = createGateway({})
    await handler.scheduled!(
      { cron: '* * * * *', scheduledTime: 1234 } as ScheduledController,
      {},
      ctx,
    )
    expect(calls.scheduled).toEqual([['* * * * *', 1234]])
  })

  it('keeps the other handlers it was given', () => {
    const queue = async () => {}
    const handler = createGateway({ queue })
    expect(handler.queue).toBe(queue)
  })

  it('replaces the fetch and scheduled it was given', async () => {
    const { calls, ctx } = context()
    const handler = createGateway({
      fetch: async () => new Response('original'),
      scheduled: async () => {},
    })
    const response = await handler.fetch!(
      new Request(`${BASE}/`) as IncomingRequest,
      {},
      ctx,
    )
    expect(await response.text()).toBe('from site')
    expect(calls.fetched).toHaveLength(1)
  })
})
