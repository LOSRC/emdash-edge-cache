import { describe, expect, it } from 'vitest'

import {
  IMAGE_BROWSER_CACHE,
  IMAGE_EDGE_CACHE,
  isImageEndpoint,
  withImageBrowserCache,
  withImageEdgeCache,
} from './image-cache.ts'

const IMAGE = new URL('https://example.com/_image?href=%2Fmedia%2Fa.jpg&w=640&f=webp')
const PAGE = new URL('https://example.com/about')
const EMDASH_IMAGE_HEADERS = { 'Cache-Control': 'public, max-age=0, must-revalidate' }

const answer = (status: number, headers: HeadersInit = EMDASH_IMAGE_HEADERS) =>
  new Response(status === 304 ? null : 'body', { status, headers })

describe('isImageEndpoint', () => {
  it('accepts the endpoint with or without a trailing slash', () => {
    expect(isImageEndpoint(new URL('https://example.com/_image'))).toBe(true)
    expect(isImageEndpoint(new URL('https://example.com/_image/?w=640'))).toBe(true)
  })

  it('rejects other paths, including sub-paths and near misses', () => {
    expect(isImageEndpoint(new URL('https://example.com/_image/x'))).toBe(false)
    expect(isImageEndpoint(new URL('https://example.com/_images'))).toBe(false)
  })

  it('gives the image rules to /_image/ (trailingSlash: always)', () => {
    const slashed = new URL('https://example.com/_image/?w=640')
    expect(withImageBrowserCache(answer(200), slashed).headers.get('Cache-Control')).toBe(
      IMAGE_BROWSER_CACHE,
    )
    const edge = withImageEdgeCache(answer(200), slashed)
    expect(edge.headers.get('Cloudflare-CDN-Cache-Control')).toBe(IMAGE_EDGE_CACHE)
  })
})

describe('withImageBrowserCache', () => {
  it('gives browsers a day and a week of stale-while-revalidate for a 200', () => {
    const response = withImageBrowserCache(answer(200), IMAGE)
    expect(response.headers.get('Cache-Control')).toBe(IMAGE_BROWSER_CACHE)
    expect(IMAGE_BROWSER_CACHE).toBe('public, max-age=86400, stale-while-revalidate=604800')
  })

  it('refreshes the lifetime on a 304', () => {
    expect(withImageBrowserCache(answer(304), IMAGE).headers.get('Cache-Control')).toBe(
      IMAGE_BROWSER_CACHE,
    )
  })

  it('leaves an error alone', () => {
    const response = withImageBrowserCache(answer(500), IMAGE)
    expect(response.headers.get('Cache-Control')).toBe(EMDASH_IMAGE_HEADERS['Cache-Control'])
  })

  it('leaves an image EmDash did not answer as public alone', () => {
    const response = withImageBrowserCache(
      answer(200, { 'Cache-Control': 'private, no-store' }),
      IMAGE,
    )
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('keeps an upstream immutable lifetime (a bundled asset served through the endpoint)', () => {
    const immutable = 'public, max-age=31536000, immutable'
    const response = withImageBrowserCache(answer(200, { 'Cache-Control': immutable }), IMAGE)
    expect(response.headers.get('Cache-Control')).toBe(immutable)
  })

  it('leaves other paths alone', () => {
    const response = withImageBrowserCache(answer(200), PAGE)
    expect(response.headers.get('Cache-Control')).toBe(EMDASH_IMAGE_HEADERS['Cache-Control'])
  })
})

describe('withImageEdgeCache', () => {
  it('keeps a 200 at the edge for an hour', () => {
    const response = withImageEdgeCache(answer(200), IMAGE)
    expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe(IMAGE_EDGE_CACHE)
    expect(IMAGE_EDGE_CACHE).toBe('public, max-age=3600')
  })

  it.each([400, 404, 500, 502])('never keeps a %i', (status) => {
    expect(withImageEdgeCache(answer(status), IMAGE).headers.get('Cloudflare-CDN-Cache-Control')).toBe(
      'no-store',
    )
  })

  it('overrides the no-store the adapter wrote for a never-cached path on a 200', () => {
    const fromAdapter = answer(200, {
      ...EMDASH_IMAGE_HEADERS,
      'Cloudflare-CDN-Cache-Control': 'no-store',
    })
    expect(
      withImageEdgeCache(fromAdapter, IMAGE).headers.get('Cloudflare-CDN-Cache-Control'),
    ).toBe(IMAGE_EDGE_CACHE)
  })

  it('gives a 304 the same hour as a 200, so revalidating does not end the stored entry', () => {
    const response = withImageEdgeCache(answer(304), IMAGE)
    expect(response.status).toBe(304)
    expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe(IMAGE_EDGE_CACHE)
  })

  it('leaves other paths alone', () => {
    expect(withImageEdgeCache(answer(200), PAGE).headers.has('Cloudflare-CDN-Cache-Control')).toBe(
      false,
    )
  })
})
