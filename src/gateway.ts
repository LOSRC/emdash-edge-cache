/**
 * What the uncached gateway does to every request. It runs before the cache, so what it does to
 * the request (dropping tracking parameters) lets a tagged link share the page's cache entry, and
 * what it adds to the response never reaches a page cached for the real domain: Workers Cache keys
 * ignore the hostname, and a Worker answers on its workers.dev address as well as its own domain.
 * The gateway always works on a copy of what `Site` returns; the original is what the cache stores.
 */
import { withImageBrowserCache } from './image-cache.ts'
import { withNoindexOnWorkersDev } from './noindex.ts'
import { withoutTrackingParams, withTrackingParamsOf } from './tracking.ts'

/** The cached site, as the gateway sees it: `ctx.exports.Site`. */
export interface SiteFetcher {
  fetch(request: Request): Promise<Response>
}

/** `ctx.exports.Site` as the gateway's `createGateway` sees it: fetch, and EmDash's cron work. */
export type SiteStub = SiteFetcher & {
  runScheduled(cron: string, scheduledTime: number): Promise<void>
}

/**
 * A redirect the site answered, with the request's tracking parameters put back on its target, so
 * a tagged link that redirects keeps its tags for analytics. Targets on other sites, and
 * redirects that need nothing added, are returned as they are.
 */
function withTrackingOnRedirect(response: Response, original: URL): Response {
  if (response.status < 300 || response.status >= 400 || response.status === 304) return response
  const location = response.headers.get('Location')
  if (!location) return response
  let target: URL
  try {
    target = new URL(location, original)
  } catch {
    return response
  }
  if (target.origin !== original.origin) return response
  const tagged = withTrackingParamsOf(target, original)
  if (tagged.search === target.search) return response
  const redirect = new Response(response.body, response)
  redirect.headers.set('Location', tagged.pathname + tagged.search + tagged.hash)
  return redirect
}

/**
 * The site's response, with resized images given a browser lifetime (image-cache.ts) and kept out
 * of search engines when the request came to a workers.dev host. The site is asked for the address
 * without its tracking parameters, so a tagged link is served from the plain page's cache entry and
 * the page renders from the plain address.
 */
export async function throughGateway(request: Request, site: SiteFetcher): Promise<Response> {
  const url = new URL(request.url)
  const plain = withoutTrackingParams(url)
  const forwarded = plain === url ? request : new Request(plain, request)
  const response = withTrackingOnRedirect(await site.fetch(forwarded), url)
  return withNoindexOnWorkersDev(withImageBrowserCache(response, url), url)
}

/**
 * The Worker's default export: the handler it was given, with `fetch` sent through the gateway to
 * `ctx.exports.Site` and `scheduled` handed to `Site.runScheduled`, so scheduled work runs inside
 * `Site`, where EmDash's runtime lives. `ctx.exports` is read structurally, so this works with
 * any site's generated types.
 */
export function createGateway<Env = unknown>(
  handler: ExportedHandler<Env> = {},
): ExportedHandler<Env> {
  const siteOf = (ctx: ExecutionContext) =>
    (ctx as unknown as { exports: { Site: SiteStub } }).exports.Site
  return {
    ...handler,
    fetch(request, _env, ctx) {
      return throughGateway(request, siteOf(ctx))
    },
    async scheduled(controller, _env, ctx) {
      await siteOf(ctx).runScheduled(controller.cron, controller.scheduledTime)
    },
  }
}
