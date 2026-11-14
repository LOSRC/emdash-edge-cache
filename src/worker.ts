/**
 * The Worker's two entrypoints: `createSite` for the cached `Site` class and `createGateway` for
 * the uncached default export in front of it. Imports `cloudflare:workers`, so it loads only inside
 * the Worker.
 */
export { EMDASH_CRON, createSite, runScheduled, withEdgeRules } from './site.ts'
export type {
  CronEvent,
  CronHandler,
  FetchHandler,
  RunScheduledOptions,
  ScheduledControllerLike,
  ScheduledHandler,
  SiteMethods,
  SiteOptions,
} from './site.ts'

export { createGateway, throughGateway } from './gateway.ts'
export type { SiteFetcher, SiteStub } from './gateway.ts'
