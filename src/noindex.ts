/**
 * Workers.dev addresses stay out of search engines: a Worker is served from one until its custom
 * domain is attached, and preview Workers keep one for good. The gateway adds the header after
 * the cache, so a cached page never carries it onto the real domain.
 */
const WORKERS_DEV = '.workers.dev'

/** Whether the URL is on a workers.dev address, which is noindex on purpose. */
export function isWorkersDev(url: URL): boolean {
  return url.hostname.endsWith(WORKERS_DEV)
}

/** The response with `X-Robots-Tag: noindex, nofollow`, when the request is on workers.dev. */
export function withNoindexOnWorkersDev(response: Response, url: URL): Response {
  if (!isWorkersDev(url)) return response
  const hidden = new Response(response.body, response)
  hidden.headers.set('X-Robots-Tag', 'noindex, nofollow')
  return hidden
}
