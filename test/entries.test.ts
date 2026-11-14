import { describe, expect, it } from 'vitest'

import * as root from '../src/index.ts'
import * as worker from '../src/worker.ts'

// What sites and deploy tools rely on by name. A rename here is a breaking change.
describe('the package root', () => {
  it('exports the config, middleware, page cache and version', () => {
    for (const name of [
      'PACKAGE_VERSION',
      'DEFAULT_ROUTE_RULES',
      'DETAIL',
      'LISTING',
      'defineCacheConfig',
      'createEdgeCacheMiddleware',
      'setPageCache',
      'PUBLIC_CACHE_CONTROL',
      'PRIVATE_NO_STORE',
      'IMAGE_BROWSER_CACHE',
      'IMAGE_EDGE_CACHE',
      'NO_VARY_SEARCH',
    ]) {
      expect(root, name).toHaveProperty(name)
    }
  })

  it('does not export the Worker entrypoints, which need cloudflare:workers', () => {
    expect(root).not.toHaveProperty('createSite')
  })
})

describe('the worker entry', () => {
  it('exports the two entrypoint factories', () => {
    expect(typeof worker.createSite).toBe('function')
    expect(typeof worker.createGateway).toBe('function')
  })
})
