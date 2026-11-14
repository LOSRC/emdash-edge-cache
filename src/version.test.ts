import { describe, expect, it } from 'vitest'

import manifest from '../package.json' with { type: 'json' }
import { PACKAGE_VERSION } from './version.ts'

describe('PACKAGE_VERSION', () => {
  it('is the version in package.json', () => {
    expect(PACKAGE_VERSION).toBe(manifest.version)
  })
})
