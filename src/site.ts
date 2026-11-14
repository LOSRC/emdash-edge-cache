import { WorkerEntrypoint } from 'cloudflare:workers'

import { isImageEndpoint, withImageEdgeCache } from './image-cache.ts'
import { STALE_IF_ERROR } from './lifetimes.ts'

/** EmDash's maintenance cron: publishes what is due and purges what changed. */
export const EMDASH_CRON = '* * * * *'

const CDN_CACHE_CONTROL = 'Cloudflare-CDN-Cache-Control'

/** The controller EmDash's scheduled handler is given. EmDash never calls `noRetry`. */
export interface ScheduledControllerLike {
  cron: string
  scheduledTime: number
  noRetry(): void
}

/** What a site's own crons are given: the cron and its time, no retry control. */
export interface CronEvent {
  cron: string
  scheduledTime: number
}

/** EmDash's `scheduled` handler (`createScheduledHandler()`), as far as this package uses it. */
export type ScheduledHandler<Env> = (
  controller: ScheduledControllerLike,
  env: Env,
  ctx: ExecutionContext,
) => unknown

/** A site's handler for its own crons, in the shape of `ExportedHandler.scheduled`. */
export type CronHandler<Env> = (event: CronEvent, env: Env, ctx: ExecutionContext) => unknown

/** EmDash's Worker handler, as far as this package uses it. Method syntax so its types fit. */
export interface FetchHandler<Env> {
  fetch?(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>
}

/**
 * The guard on everything `Site` returns, so it holds even for a site that forgot the middleware:
 * only a 200 is ever kept at the edge, and a kept page can be served stale for a week if the
 * Worker fails.
 *
 * - A resized image gets its own edge lifetime (image-cache.ts): an hour for a 200, nothing else.
 * - A 304 for a page is returned as it is: Workers Cache revalidates a stored entry with a
 *   conditional request, and a 304 tells it to keep what it has.
 * - Any other status than 200 is marked `no-store`: nothing would purge it.
 * - A 200 the adapter made public with a `max-age` gets `stale-if-error`, which Astro's route rules
 *   cannot say. One the adapter marked `no-store` is left alone.
 * - A 200 whose CDN header has no `max-age` is marked `no-store`. That is a route with no rule
 *   that still called `setPageCache` with hints: the header exists (`public`, tags only), so the
 *   adapter's own `no-store` default does not fire, and Workers Cache may keep such a response by
 *   heuristic. A route with no rule must not be cached.
 * - A 200 with no CDN header at all is returned as it is. For a rendered route with the cache
 *   provider configured the adapter has already written `no-store`, so it does not arise; a site
 *   without the provider gets no edge header from anything here (see the README).
 */
export function withEdgeRules(response: Response, url: URL): Response {
  if (isImageEndpoint(url)) return withImageEdgeCache(response, url)
  if (response.status === 304) return response
  const cdn = response.headers.get(CDN_CACHE_CONTROL)
  if (response.status !== 200) return withCdnCacheControl(response, 'no-store')
  if (cdn && !cdn.includes('no-store')) {
    if (!cdn.includes('max-age=')) return withCdnCacheControl(response, 'no-store')
    if (cdn.startsWith('public') && !cdn.includes('stale-if-error')) {
      return withCdnCacheControl(response, `${cdn}, stale-if-error=${STALE_IF_ERROR}`)
    }
  }
  return response
}

/** A copy of the response with its edge lifetime set (a response's headers may be immutable). */
function withCdnCacheControl(response: Response, value: string): Response {
  const copy = new Response(response.body, response)
  copy.headers.set(CDN_CACHE_CONTROL, value)
  return copy
}

/**
 * The context with `waitUntil` swapped for one that collects. A proxy rather than a spread: in
 * workerd the context's members live on its prototype, and its methods need the real context as
 * `this`.
 */
function collectingCtx(ctx: ExecutionContext, pending: Promise<unknown>[]): ExecutionContext {
  const waitUntil = (work: Promise<unknown>) => void pending.push(work)
  return new Proxy(ctx, {
    get(target, property) {
      if (property === 'waitUntil') return waitUntil
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

export interface RunScheduledOptions<Env> {
  cron: string
  scheduledTime: number
  scheduled: ScheduledHandler<Env>
  onCron?: CronHandler<Env> | undefined
  env: Env
  ctx: ExecutionContext
}

/**
 * Runs one cron and waits for everything it started. EmDash's sweep hands its work to
 * `ctx.waitUntil` and returns; this collects that work and waits for it, so the gateway's cron
 * invocation lasts until publishing and purging are done, and a failure surfaces. The cron
 * EmDash owns goes to EmDash (as does every cron when the site has no `onCron`); the rest go to
 * the site's `onCron`. If the handler throws, the work it already handed over is still awaited and
 * the handler's error is rethrown.
 */
export async function runScheduled<Env>(options: RunScheduledOptions<Env>): Promise<void> {
  const { cron, scheduledTime, scheduled, onCron, env } = options
  const pending: Promise<unknown>[] = []
  const ctx = collectingCtx(options.ctx, pending)
  let failure: { error: unknown } | undefined
  try {
    if (cron === EMDASH_CRON || !onCron) {
      await scheduled({ cron, scheduledTime, noRetry() {} }, env, ctx)
    } else {
      await onCron({ cron, scheduledTime }, env, ctx)
    }
  } catch (error) {
    failure = { error }
  }
  // Drain in a loop: a task may itself hand more work to waitUntil. Settle everything, even after
  // the handler failed, so no rejection goes unhandled.
  const rejections: unknown[] = []
  while (pending.length > 0) {
    for (const result of await Promise.allSettled(pending.splice(0))) {
      if (result.status === 'rejected') rejections.push(result.reason)
    }
  }
  // The handler's own error comes first; otherwise the first rejection.
  if (failure) throw failure.error
  if (rejections.length > 0) throw rejections[0]
}

/** The `Site` entrypoint: what `createSite` builds a class of. */
export interface SiteMethods {
  fetch(request: Request): Promise<Response>
  runScheduled(cron: string, scheduledTime: number): Promise<void>
}

export interface SiteOptions<Env> {
  /** EmDash's Worker handler (`import handler from '@emdash-cms/cloudflare/worker'`). */
  handler: FetchHandler<Env>
  /** EmDash's `createScheduledHandler()`. */
  scheduled: ScheduledHandler<Env>
  /** A site's other crons. Without it, every cron goes to EmDash. */
  onCron?: CronHandler<Env>
}

/**
 * The site itself, the cached entrypoint (`wrangler.jsonc` `exports`). A site writes
 * `export class Site extends createSite<Env>({ handler, scheduled }) {}`.
 *
 * Purges only reach the cache of the entrypoint that makes them, so everything that purges runs
 * here: EmDash's publish hooks inside `fetch`, and the scheduled jobs, which the gateway forwards
 * to `runScheduled`.
 */
export function createSite<Env>(
  options: SiteOptions<Env>,
): new (ctx: ExecutionContext, env: Env) => WorkerEntrypoint<Env> & SiteMethods {
  const { handler, scheduled, onCron } = options
  return class Site extends WorkerEntrypoint<Env> implements SiteMethods {
    override async fetch(request: Request): Promise<Response> {
      if (!handler.fetch) throw new Error('EmDash’s Worker handler has no fetch')
      const response = await handler.fetch(request, this.env, this.ctx)
      return withEdgeRules(response, new URL(request.url))
    }

    async runScheduled(cron: string, scheduledTime: number): Promise<void> {
      await runScheduled({ cron, scheduledTime, scheduled, onCron, env: this.env, ctx: this.ctx })
    }
  }
}
