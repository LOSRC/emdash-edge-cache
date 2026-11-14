import { withoutTrailingSlash } from './path.ts'

/**
 * How long browsers and the edge keep resized images (`/_image`). EmDash serves them with
 * `Cache-Control: max-age=0, must-revalidate`, because replacing a file in the Media Library
 * overwrites it in place: the file's address, and so the `/_image` address of every size of it,
 * stays the same, and nothing purges the edge when that happens. Without these rules a page of
 * ten images sends ten revalidations, each running the Worker and reading storage.
 *
 * - Browsers keep an image for a day, then a week of stale-while-revalidate. Set by the gateway,
 *   after the cache, so the edge never stores it.
 * - The edge keeps a 200 for an hour and nothing else. Set inside `Site`, so Workers Cache sees it.
 *   An hour is how long a replaced image can show its old self at the edge; the browser's day comes
 *   on top. An error is never kept: there is nothing to purge it by.
 *
 * `/_image` is also a never-cached path for the middleware (rules.ts), so no page route rule (a
 * `/[slug]` rule matches `/_image`) can give an image response its own lifetime.
 */
export const IMAGE_ENDPOINT = '/_image'

/** What browsers are told for a resized image. */
export const IMAGE_BROWSER_CACHE = 'public, max-age=86400, stale-while-revalidate=604800'

/** What the edge is told for a resized image that answered 200. */
export const IMAGE_EDGE_CACHE = 'public, max-age=3600'

/** Statuses whose headers a browser stores: a 304 refreshes the stored lifetime. */
const BROWSER_STATUSES = new Set([200, 304])

/** Whether the URL is the image endpoint, with or without a slash (`trailingSlash: 'always'`). */
export function isImageEndpoint(url: URL): boolean {
  return withoutTrailingSlash(url.pathname) === IMAGE_ENDPOINT
}

/**
 * The response with the browser lifetime for a resized image, when it is one EmDash answered as
 * public. Anything else is returned as it is.
 */
export function withImageBrowserCache(response: Response, url: URL): Response {
  if (!isImageEndpoint(url) || !BROWSER_STATUSES.has(response.status)) return response
  const upstream = response.headers.get('Cache-Control')
  if (!upstream?.startsWith('public')) return response
  // A bundled asset served through the endpoint comes with a year and `immutable`; keep it.
  if (upstream.includes('immutable')) return response
  const cached = new Response(response.body, response)
  cached.headers.set('Cache-Control', IMAGE_BROWSER_CACHE)
  return cached
}

/**
 * The response with the edge lifetime for a resized image: an hour for a 200 or a 304, `no-store`
 * for any other status. Anything not an image is returned as it is.
 *
 * A 304 gets the hour too: Workers Cache revalidates its stored image with a conditional request
 * once the hour is up, and per RFC 9111 section 4.3.4 the headers of a 304 update the stored
 * entry. Without this the 304 carries the adapter's `no-store` (the middleware disables the route
 * cache for `/_image`), which would end the stored entry's life.
 */
export function withImageEdgeCache(response: Response, url: URL): Response {
  if (!isImageEndpoint(url)) return response
  const cached = new Response(response.body, response)
  cached.headers.set(
    'Cloudflare-CDN-Cache-Control',
    response.status === 200 || response.status === 304 ? IMAGE_EDGE_CACHE : 'no-store',
  )
  return cached
}
