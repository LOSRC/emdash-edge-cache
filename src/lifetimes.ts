/**
 * The default lifetimes, in seconds. A detail page (one entry) changes when its entry is published,
 * and EmDash purges it then, so the edge keeps it a day. A listing also changes when something it
 * lists is published elsewhere, so it is kept ten minutes. Both may be served stale for a week
 * while the edge refreshes them in the background, and for a week if the Worker fails.
 */
export const DAY = 24 * 60 * 60
export const WEEK = 7 * DAY

/** A route rule in Astro's shape (`routeRules`): only these three keys reach the adapter. */
export interface RouteRule {
  maxAge?: number
  swr?: number
  tags?: string[]
}

export const DETAIL: Readonly<RouteRule> = Object.freeze({ maxAge: DAY, swr: WEEK })
export const LISTING: Readonly<RouteRule> = Object.freeze({ maxAge: 10 * 60, swr: WEEK })

/**
 * How long the edge may serve a stale page when the Worker fails (throws, times out or answers
 * 5xx) while refreshing it. Astro's route rules cannot say this, so `Site` appends it to every
 * cached page (site.ts). Without it Workers Cache would serve a stale page on error for ever.
 */
export const STALE_IF_ERROR = WEEK
