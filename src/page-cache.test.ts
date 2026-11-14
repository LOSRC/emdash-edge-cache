import { describe, expect, it } from 'vitest'

import { PRIVATE_NO_STORE, PUBLIC_CACHE_CONTROL, setPageCache } from './page-cache.ts'
import { NO_VARY_SEARCH } from './tracking.ts'

/** A page: records every call to `cache.set`, and owns the response headers. */
function target() {
  const calls: unknown[] = []
  return {
    calls,
    cache: { set: (value: unknown) => calls.push(value) },
    response: { headers: new Headers() },
  }
}

describe('setPageCache', () => {
  it('exports the two Cache-Control values', () => {
    expect(PUBLIC_CACHE_CONTROL).toBe('public, max-age=0, must-revalidate')
    expect(PRIVATE_NO_STORE).toBe('private, no-store')
  })

  it('passes every hint on to the cache', () => {
    const page = target()
    const when = new Date('2026-01-01T00:00:00Z')
    const hints = [{ tags: ['pages:about'] }, { tags: ['emdash:settings'] }, { lastModified: when }]
    setPageCache(page, { hints })
    expect(page.calls).toEqual(hints)
  })

  it('has browsers revalidate and the edge hold the page, as its route rule says', () => {
    const page = target()
    setPageCache(page, {})
    expect(page.response.headers.get('Cache-Control')).toBe(PUBLIC_CACHE_CONTROL)
    expect(page.calls).toEqual([])
  })

  it('tells browsers the page does not vary with the tracking parameters the gateway drops', () => {
    const page = target()
    setPageCache(page, { hints: [{ tags: ['pages:about'] }] })
    expect(page.response.headers.get('No-Vary-Search')).toBe(NO_VARY_SEARCH)
  })

  it('keeps a preview out of every cache and sets nothing for a browser to share', () => {
    const page = target()
    setPageCache(page, { isPreview: true, hints: [{ tags: ['pages:about'] }] })
    expect(page.calls).toEqual([false])
    expect(page.response.headers.get('Cache-Control')).toBe(PRIVATE_NO_STORE)
    expect(page.response.headers.get('No-Vary-Search')).toBeNull()
  })

  it('does not throw without a cache provider', () => {
    const response = { headers: new Headers() }
    expect(() => setPageCache({ response }, { hints: [{ tags: ['a'] }] })).not.toThrow()
    expect(response.headers.get('Cache-Control')).toBe(PUBLIC_CACHE_CONTROL)
    const preview = { headers: new Headers() }
    setPageCache({ response: preview }, { isPreview: true })
    expect(preview.headers.get('Cache-Control')).toBe(PRIVATE_NO_STORE)
  })
})
