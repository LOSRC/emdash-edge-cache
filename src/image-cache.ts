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
  // Every public image gets the day, even one sent with a year and `immutable` (media served from a
  // public storage URL can still be replaced in place).
  if (!upstream?.startsWith('public')) return response
  const cached = new Response(response.body, response)
  cached.headers.set('Cache-Control', IMAGE_BROWSER_CACHE)
  return cached
}

/** Whether the middleware marked the response private (a signed-in, preview or edit-mode render). */
function isPrivate(response: Response): boolean {
  return /\b(?:private|no-store)\b/.test(response.headers.get('Cache-Control') ?? '')
}

/**
 * The response with the edge lifetime for a resized image: an hour for a 200, and `no-store` for
 * anything else, a 304 included, and for a 200 the middleware marked private (the next anonymous
 * visitor would otherwise be served its `private, no-store` and lose the browser day for the hour).
 *
 * A 304 is never kept: EmDash answers a browser's conditional request with one itself, and what
 * Workers Cache does with a body-less 304 on a key it has not stored is not documented. `no-store`
 * costs at most one extra miss.
 */
export function withImageEdgeCache(response: Response, url: URL): Response {
  if (!isImageEndpoint(url)) return response
  const kept = response.status === 200 && !isPrivate(response)
  const cached = new Response(response.body, response)
  cached.headers.set('Cloudflare-CDN-Cache-Control', kept ? IMAGE_EDGE_CACHE : 'no-store')
  return cached
}
