import { describe, expect, it } from 'vitest'

import { isWorkersDev, withNoindexOnWorkersDev } from './noindex.ts'

const page = () =>
  new Response('<p>Hi</p>', { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public' } })

describe('withNoindexOnWorkersDev', () => {
  it('asks search engines not to index anything on a workers.dev address', () => {
    const response = withNoindexOnWorkersDev(
      page(),
      new URL('https://my-site.example.workers.dev/about/'),
    )
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
  })

  it('covers any workers.dev host, such as a preview Worker', () => {
    const url = new URL('https://my-site-preview.example.workers.dev/')
    expect(withNoindexOnWorkersDev(page(), url).headers.get('X-Robots-Tag')).toBe(
      'noindex, nofollow',
    )
  })

  it('leaves a custom domain alone', () => {
    const original = page()
    expect(withNoindexOnWorkersDev(original, new URL('https://example.com/'))).toBe(original)
  })

  it('keeps the response’s body, status and other headers', async () => {
    const response = withNoindexOnWorkersDev(
      new Response('gone', { status: 410, headers: { 'Cache-Control': 'no-store' } }),
      new URL('https://x.example.workers.dev/old/'),
    )
    expect(response.status).toBe(410)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.text()).toBe('gone')
  })

  it('does not change the response it was given', () => {
    const original = page()
    withNoindexOnWorkersDev(original, new URL('https://x.example.workers.dev/'))
    expect(original.headers.has('X-Robots-Tag')).toBe(false)
  })

  it('isn’t fooled by a domain that merely contains workers.dev', () => {
    const original = page()
    expect(withNoindexOnWorkersDev(original, new URL('https://workers.dev.example.org/'))).toBe(
      original,
    )
  })
})

describe('isWorkersDev', () => {
  it('is true for a workers.dev subdomain and false for anything else', () => {
    expect(isWorkersDev(new URL('https://a.b.workers.dev/'))).toBe(true)
    expect(isWorkersDev(new URL('https://example.com/'))).toBe(false)
  })
})
