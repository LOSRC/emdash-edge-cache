import { describe, expect, it } from 'vitest'

import { NO_VARY_SEARCH, withoutTrackingParams, withTrackingParamsOf } from './tracking.ts'

const strip = (path: string) => {
  const url = withoutTrackingParams(new URL(path, 'https://example.com'))
  return url.pathname + url.search
}

describe('withoutTrackingParams', () => {
  it('drops campaign tags so a tagged link shares the page’s cache entry', () => {
    expect(strip('/about/?utm_source=newsletter&utm_medium=email')).toBe('/about/')
  })

  it('drops click ids and Mailchimp tags', () => {
    expect(strip('/about/?fbclid=abc&gclid=def&mc_cid=1&mc_eid=2')).toBe('/about/')
  })

  it('drops any utm_ or mc_ tag, not just the common ones', () => {
    expect(strip('/?utm_source_platform=meta&mc_tc=x')).toBe('/')
  })

  it('keeps the parameters a page answers to, in order', () => {
    expect(strip('/about/?utm_campaign=x&q=pod&_preview=t')).toBe('/about/?q=pod&_preview=t')
  })

  it('does not mistake a parameter that merely contains a tag name', () => {
    expect(strip('/about/?my_utm_source=1&gclid_x=2&fbclidx=3')).toBe(
      '/about/?my_utm_source=1&gclid_x=2&fbclidx=3',
    )
  })

  it('keeps the other parameters exactly as written', () => {
    expect(strip('/about/?q=a%20b&utm_source=x&tag=c+d&e=%2F')).toBe(
      '/about/?q=a%20b&tag=c+d&e=%2F',
    )
  })

  it('keeps a parameter with no value', () => {
    expect(strip('/about/?flag&utm_source=x')).toBe('/about/?flag')
  })

  it('leaves no question mark when every parameter was a tag', () => {
    expect(withoutTrackingParams(new URL('https://example.com/about/?utm_source=x')).href).toBe(
      'https://example.com/about/',
    )
  })

  it('decides on the decoded name, so an encoded tag next to a plain one is dropped too', () => {
    expect(strip('/about/?utm_source=x&utm%5Fmedium=y&q=1')).toBe('/about/?q=1')
  })

  it('keeps a parameter whose name cannot be decoded', () => {
    expect(strip('/about/?%E0%A4%A=1&utm_source=x')).toBe('/about/?%E0%A4%A=1')
  })

  it('hands back the same URL when the pattern matched but nothing was a tag', () => {
    const url = new URL('https://example.com/about/?q=1&my=utm_source%3D1&a=%26utm_x')
    expect(withoutTrackingParams(url)).toBe(url)
  })

  it('hands back the very same URL when there is nothing to drop', () => {
    const url = new URL('https://example.com/about/?q=pod')
    expect(withoutTrackingParams(url)).toBe(url)
  })

  it('does not change the URL it was given', () => {
    const url = new URL('https://example.com/about/?utm_source=x&q=1')
    withoutTrackingParams(url)
    expect(url.search).toBe('?utm_source=x&q=1')
  })
})

describe('withTrackingParamsOf', () => {
  const request = new URL('https://example.com/old/?utm_source=newsletter&q=x')

  it('puts a tagged link’s tags back on the redirect it leads to, and only the tags', () => {
    const target = withTrackingParamsOf(new URL('/new/', request), request)
    expect(target.pathname + target.search).toBe('/new/?utm_source=newsletter')
  })

  it('does not override a tag the target already carries', () => {
    const target = withTrackingParamsOf(new URL('/new/?utm_source=other', request), request)
    expect(target.search).toBe('?utm_source=other')
  })

  it('leaves a redirect to another site alone', () => {
    const target = new URL('https://accounts.example.org/oauth2')
    expect(withTrackingParamsOf(target, request)).toBe(target)
  })
})

describe('NO_VARY_SEARCH', () => {
  it('names the common tracking parameters as a structured-field list', () => {
    expect(NO_VARY_SEARCH).toBe(
      'params=("utm_source" "utm_medium" "utm_campaign" "utm_term" "utm_content" "utm_id" ' +
        '"mc_cid" "mc_eid" "fbclid" "gclid")',
    )
  })
})
