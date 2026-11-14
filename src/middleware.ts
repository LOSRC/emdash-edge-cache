/**
 * The middleware that keeps the wrong things out of the cache, whatever route rule matched.
 *
 * Astro's route cache is seeded with a path's rule before the route runs, and the provider writes
 * its CDN headers after the whole middleware chain has returned. So a response is kept out of the
 * edge by `cache.set(false)`, which clears the seed. A `Cache-Control` header alone does nothing
 * there, and deleting a CDN header does nothing either: the provider has not written its own yet.
 * Headers are for browsers and shared caches, and they are set here as well.
 *
 * Register it as EmDash's outer middleware rather than Astro's own: EmDash answers its Redirects
 * rows from a middleware registered ahead of the site's, so only an outer one sees those answers.
 */
import { PRIVATE_NO_STORE } from './page-cache.ts'
import { isNeverCached, type NormalisedEdgeCacheConfig, under } from './rules.ts'

/** The part of Astro's middleware context this reads. */
export interface EdgeCacheContext {
  url: URL
  cookies: { get(name: string): { value: string } | undefined }
  /** Absent when no cache provider is configured (development). */
  cache?: { set(value: false): void }
  /** EmDash sets `user` for a signed-in visitor, after the route ran. */
  locals?: { user?: unknown }
}

/** A copy of the response saying it must not be kept (a handler's headers may be immutable). */
function neverStore(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', PRIVATE_NO_STORE)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export function createEdgeCacheMiddleware(config: NormalisedEdgeCacheConfig) {
  return async function edgeCache(
    context: EdgeCacheContext,
    next: () => Promise<Response>,
  ): Promise<Response> {
    const { url, cache } = context
    const { pathname, searchParams } = url

    // A preview (whether or not its token is valid), an editor's toolbar render, edit mode and the
    // admin all show one person something the public must not be served.
    const isPrivate =
      searchParams.has('_preview') ||
      searchParams.has('_edit') ||
      context.cookies.get('emdash-edit-mode')?.value === 'true' ||
      under(pathname, '/_emdash/admin')
    const never = isNeverCached(pathname, config)

    // Before the route runs, so nothing it does can leave the seeded rule in place.
    if (isPrivate || never) cache?.set(false)

    const response = await next()

    // The user is known only now. EmDash's own routes under /_emdash manage their own caching.
    const signedIn = !!context.locals?.user && !under(pathname, '/_emdash')

    // And again after, in case the route (or a rewrite) set a hint of its own.
    if (isPrivate || never || signedIn || response.status !== 200) cache?.set(false)

    if (isPrivate || signedIn) return neverStore(response)
    // What is missing depends on the address and on what is published, and nothing would purge a
    // kept 404 once the page exists. The same goes for a redirect (an editor changes or removes
    // one) and for an error. A 304 is a browser revalidating something it holds, so it keeps what
    // it was sent. A 200 keeps its own header; media files keep their immutable one.
    if (response.status >= 300 && response.status !== 304) return neverStore(response)
    return response
  }
}
