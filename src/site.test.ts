import { describe, expect, it, vi } from 'vitest'

import { IMAGE_EDGE_CACHE } from './image-cache.ts'
import { STALE_IF_ERROR } from './lifetimes.ts'
import { EMDASH_CRON, createSite, runScheduled, withEdgeRules } from './site.ts'

const PAGE = new URL('https://example.com/about')
const IMAGE = new URL('https://example.com/_image?href=%2Fmedia%2Fa.jpg&w=640')
const CDN = 'Cloudflare-CDN-Cache-Control'
const ROUTE_RULE = 'public, max-age=86400, stale-while-revalidate=604800'

const answer = (status: number, headers: HeadersInit = {}) =>
  new Response(status === 304 ? null : 'body', { status, headers })

describe('withEdgeRules', () => {
  it('keeps a resized image for an hour at the edge', () => {
    const response = withEdgeRules(answer(200, { [CDN]: 'no-store' }), IMAGE)
    expect(response.headers.get(CDN)).toBe(IMAGE_EDGE_CACHE)
  })

  it.each([404, 500])('never keeps a %i image', (status) => {
    expect(withEdgeRules(answer(status), IMAGE).headers.get(CDN)).toBe('no-store')
  })

  it('never keeps a 304 for an image', () => {
    const response = withEdgeRules(answer(304, { [CDN]: 'no-store' }), IMAGE)
    expect(response.status).toBe(304)
    expect(response.headers.get(CDN)).toBe('no-store')
  })

  it('appends stale-if-error to a page the route rule made public', () => {
    const response = withEdgeRules(answer(200, { [CDN]: ROUTE_RULE }), PAGE)
    expect(response.headers.get(CDN)).toBe(`${ROUTE_RULE}, stale-if-error=${STALE_IF_ERROR}`)
  })

  it('appends stale-if-error once, not twice', () => {
    const once = withEdgeRules(answer(200, { [CDN]: ROUTE_RULE }), PAGE)
    const twice = withEdgeRules(once, PAGE)
    expect(twice.headers.get(CDN)).toBe(`${ROUTE_RULE}, stale-if-error=${STALE_IF_ERROR}`)
  })

  it('keeps a stale-if-error a page already has', () => {
    const own = 'public, max-age=60, stale-if-error=30'
    expect(withEdgeRules(answer(200, { [CDN]: own }), PAGE).headers.get(CDN)).toBe(own)
  })

  it('leaves a 200 the adapter marked no-store alone', () => {
    expect(withEdgeRules(answer(200, { [CDN]: 'no-store' }), PAGE).headers.get(CDN)).toBe(
      'no-store',
    )
  })

  it('marks a 200 without a CDN header no-store (a site without the cache provider)', () => {
    const response = withEdgeRules(answer(200, { 'Cache-Control': 'public, max-age=60' }), PAGE)
    expect(response.headers.get(CDN)).toBe('no-store')
    // Browsers keep what the site said.
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60')
  })

  it('marks a public 200 without a max-age no-store, so the cache guesses no lifetime', () => {
    const response = withEdgeRules(answer(200, { [CDN]: 'public' }), PAGE)
    expect(response.headers.get(CDN)).toBe('no-store')
  })

  it('marks a route with no rule that only set cache tags no-store', () => {
    // What setPageCache leaves when no route rule seeded a lifetime: public plus tags, no max-age.
    const response = withEdgeRules(answer(200, { [CDN]: 'public', 'Cache-Tag': 'a,b' }), PAGE)
    expect(response.headers.get(CDN)).toBe('no-store')
    expect(response.headers.get('Cache-Tag')).toBe('a,b')
  })

  it.each([301, 404, 500])('never keeps a %i, even one a route rule made public', (status) => {
    const response = withEdgeRules(answer(status, { [CDN]: ROUTE_RULE }), PAGE)
    expect(response.headers.get(CDN)).toBe('no-store')
  })

  it('leaves a 304 alone', () => {
    const response = withEdgeRules(answer(304), PAGE)
    expect(response.status).toBe(304)
    expect(response.headers.has(CDN)).toBe(false)
  })

  it('keeps the status, body and other headers of the copy it makes', async () => {
    const response = withEdgeRules(answer(404, { 'X-Other': 'yes' }), PAGE)
    expect(response.status).toBe(404)
    expect(response.headers.get('X-Other')).toBe('yes')
    expect(await response.text()).toBe('body')
  })
})

describe('runScheduled', () => {
  const env = { name: 'env' }
  const baseCtx = { waitUntil: () => {}, passThroughOnException() {}, props: { a: 1 } }
  const ctx = baseCtx as unknown as ExecutionContext

  it('waits for the work EmDash hands to waitUntil', async () => {
    let finished = false
    const scheduled = vi.fn((_c: unknown, _e: unknown, c: ExecutionContext) => {
      c.waitUntil(
        new Promise<void>((resolve) =>
          setTimeout(() => {
            finished = true
            resolve()
          }, 10),
        ),
      )
    })
    await runScheduled({ cron: EMDASH_CRON, scheduledTime: 1, scheduled, env, ctx })
    expect(finished).toBe(true)
  })

  it('gives EmDash a controller and the other ctx members', async () => {
    const scheduled = vi.fn()
    await runScheduled({ cron: EMDASH_CRON, scheduledTime: 42, scheduled, env, ctx })
    const [controller, passedEnv, passedCtx] = scheduled.mock.calls[0] as [
      { cron: string; scheduledTime: number; noRetry(): void },
      unknown,
      { props: unknown; waitUntil: unknown },
    ]
    expect(controller.cron).toBe(EMDASH_CRON)
    expect(controller.scheduledTime).toBe(42)
    expect(() => controller.noRetry()).not.toThrow()
    expect(passedEnv).toBe(env)
    expect(passedCtx.props).toBe(baseCtx.props)
    expect(passedCtx.waitUntil).not.toBe(baseCtx.waitUntil)
  })

  it('keeps a context whose members live on its prototype working', async () => {
    class RealCtx {
      calls = 0
      props = { a: 1 }
      waitUntil(_work: Promise<unknown>) {}
      passThroughOnException() {
        this.calls += 1
      }
    }
    const real = new RealCtx()
    const scheduled = (_c: unknown, _e: unknown, c: ExecutionContext) => c.passThroughOnException()
    await runScheduled({
      cron: EMDASH_CRON,
      scheduledTime: 1,
      scheduled,
      env,
      ctx: real as unknown as ExecutionContext,
    })
    expect(real.calls).toBe(1)
  })

  it('sends every cron to EmDash when the site has no onCron', async () => {
    const scheduled = vi.fn()
    await runScheduled({ cron: '0 3 * * *', scheduledTime: 1, scheduled, env, ctx })
    expect(scheduled).toHaveBeenCalledTimes(1)
  })

  it('sends EmDash its own cron to EmDash, and not to onCron', async () => {
    const scheduled = vi.fn()
    const onCron = vi.fn()
    await runScheduled({ cron: EMDASH_CRON, scheduledTime: 1, scheduled, onCron, env, ctx })
    expect(scheduled).toHaveBeenCalledTimes(1)
    expect(onCron).not.toHaveBeenCalled()
  })

  it('sends a site cron to onCron, and not to EmDash', async () => {
    const scheduled = vi.fn()
    const onCron = vi.fn()
    await runScheduled({ cron: '0 3 * * *', scheduledTime: 7, scheduled, onCron, env, ctx })
    expect(scheduled).not.toHaveBeenCalled()
    const [controller, passedEnv] = onCron.mock.calls[0] ?? []
    expect(controller).toEqual({ cron: '0 3 * * *', scheduledTime: 7 })
    expect(passedEnv).toBe(env)
  })

  it('waits for the work a site cron hands to waitUntil', async () => {
    let finished = false
    const onCron = (_c: unknown, _e: unknown, c: ExecutionContext) => {
      c.waitUntil(
        new Promise<void>((resolve) =>
          setTimeout(() => {
            finished = true
            resolve()
          }, 10),
        ),
      )
    }
    await runScheduled({
      cron: '0 3 * * *',
      scheduledTime: 1,
      scheduled: vi.fn(),
      onCron,
      env,
      ctx,
    })
    expect(finished).toBe(true)
  })

  it('waits for work that a waitUntil task hands to waitUntil later', async () => {
    let finished = false
    const scheduled = (_c: unknown, _e: unknown, c: ExecutionContext) => {
      c.waitUntil(
        new Promise<void>((resolve) =>
          setTimeout(() => {
            c.waitUntil(
              new Promise<void>((done) =>
                setTimeout(() => {
                  finished = true
                  done()
                }, 10),
              ),
            )
            resolve()
          }, 10),
        ),
      )
    }
    await runScheduled({ cron: EMDASH_CRON, scheduledTime: 1, scheduled, env, ctx })
    expect(finished).toBe(true)
  })

  it('finishes the work already handed over when the handler throws, then rethrows', async () => {
    let finished = false
    const onCron = (_c: unknown, _e: unknown, c: ExecutionContext) => {
      c.waitUntil(
        new Promise<void>((resolve) =>
          setTimeout(() => {
            finished = true
            resolve()
          }, 10),
        ),
      )
      c.waitUntil(Promise.reject(new Error('task failed')))
      throw new Error('cron failed')
    }
    await expect(
      runScheduled({
        cron: '0 3 * * *',
        scheduledTime: 1,
        scheduled: vi.fn(),
        onCron,
        env,
        ctx,
      }),
    ).rejects.toThrow('cron failed')
    expect(finished).toBe(true)
  })

  it('still finishes the work already handed over when the handler rejects', async () => {
    let finished = false
    const scheduled = async (_c: unknown, _e: unknown, c: ExecutionContext) => {
      c.waitUntil(
        new Promise<void>((resolve) =>
          setTimeout(() => {
            finished = true
            resolve()
          }, 10),
        ),
      )
      throw new Error('sweep failed')
    }
    await expect(
      runScheduled({ cron: EMDASH_CRON, scheduledTime: 1, scheduled, env, ctx }),
    ).rejects.toThrow('sweep failed')
    expect(finished).toBe(true)
  })

  it('surfaces the first rejection after every task has settled', async () => {
    let finished = false
    const scheduled = (_c: unknown, _e: unknown, c: ExecutionContext) => {
      c.waitUntil(Promise.reject(new Error('first failed')))
      c.waitUntil(
        new Promise<void>((resolve) =>
          setTimeout(() => {
            finished = true
            resolve()
          }, 10),
        ),
      )
      c.waitUntil(Promise.reject(new Error('second failed')))
    }
    await expect(
      runScheduled({ cron: EMDASH_CRON, scheduledTime: 1, scheduled, env, ctx }),
    ).rejects.toThrow('first failed')
    expect(finished).toBe(true)
  })

  it('surfaces work that fails', async () => {
    const scheduled = (_c: unknown, _e: unknown, c: ExecutionContext) => {
      c.waitUntil(Promise.reject(new Error('publish failed')))
    }
    await expect(
      runScheduled({ cron: EMDASH_CRON, scheduledTime: 1, scheduled, env, ctx }),
    ).rejects.toThrow('publish failed')
  })

  it('surfaces a site cron that throws', async () => {
    const onCron = () => {
      throw new Error('cron failed')
    }
    await expect(
      runScheduled({
        cron: '0 3 * * *',
        scheduledTime: 1,
        scheduled: vi.fn(),
        onCron,
        env,
        ctx,
      }),
    ).rejects.toThrow('cron failed')
  })
})

describe('createSite', () => {
  interface Env {
    name: string
  }
  const env: Env = { name: 'env' }
  const ctx = { waitUntil: () => {}, passThroughOnException() {} } as unknown as ExecutionContext

  it('calls the handler with the Site’s own env and ctx, and guards the answer', async () => {
    const fetch = vi.fn(async (_request: Request, _env: Env, _ctx: ExecutionContext) =>
      answer(200, { [CDN]: ROUTE_RULE }),
    )
    class Site extends createSite<Env>({ handler: { fetch }, scheduled: vi.fn() }) {}
    const request = new Request('https://example.com/about')
    const response = await new Site(ctx, env).fetch(request)
    expect(fetch).toHaveBeenCalledWith(request, env, ctx)
    expect(response.headers.get(CDN)).toBe(`${ROUTE_RULE}, stale-if-error=${STALE_IF_ERROR}`)
  })

  it('keeps an image out of the cache when it fails', async () => {
    class Site extends createSite<Env>({
      handler: { fetch: async () => answer(500) },
      scheduled: vi.fn(),
    }) {}
    const response = await new Site(ctx, env).fetch(new Request('https://example.com/_image?w=1'))
    expect(response.headers.get(CDN)).toBe('no-store')
  })

  it('fails clearly when the handler has no fetch', async () => {
    class Site extends createSite<Env>({ handler: {}, scheduled: vi.fn() }) {}
    await expect(new Site(ctx, env).fetch(new Request('https://example.com/'))).rejects.toThrow(
      /no fetch/,
    )
  })

  it('forwards runScheduled with the Site’s own env and ctx', async () => {
    const scheduled = vi.fn()
    const onCron = vi.fn()
    class Site extends createSite<Env>({ handler: {}, scheduled, onCron }) {}
    const site = new Site(ctx, env)
    await site.runScheduled(EMDASH_CRON, 5)
    await site.runScheduled('0 3 * * *', 6)
    expect(scheduled.mock.calls[0]?.[0]).toMatchObject({ cron: EMDASH_CRON, scheduledTime: 5 })
    expect(scheduled.mock.calls[0]?.[1]).toBe(env)
    expect(onCron.mock.calls[0]?.[0]).toEqual({ cron: '0 3 * * *', scheduledTime: 6 })
  })

  it('takes a handler whose fetch wants Cloudflare’s incoming request type', async () => {
    const handler = {
      async fetch(request: Request<unknown, IncomingRequestCfProperties>) {
        return answer(200, { 'X-Url': request.url })
      },
    }
    class Site extends createSite<Env>({ handler, scheduled: vi.fn() }) {}
    const response = await new Site(ctx, env).fetch(new Request('https://example.com/'))
    expect(response.headers.get('X-Url')).toBe('https://example.com/')
  })

  it('types this.env and this.ctx for a site that adds its own methods', async () => {
    class Site extends createSite<Env>({ handler: {}, scheduled: vi.fn() }) {
      name(): string {
        const waiting: ExecutionContext['waitUntil'] = this.ctx.waitUntil
        void waiting
        return this.env.name
      }
    }
    expect(new Site(ctx, env).name()).toBe('env')
  })
})
