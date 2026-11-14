/**
 * A path without one trailing slash (the root stays `/`). Astro's default `trailingSlash: 'ignore'`
 * serves `/cart/` from the `/cart` page, while Workers Cache keys the two addresses separately, so
 * every exact-path comparison drops the slash on both sides.
 */
export function withoutTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}
