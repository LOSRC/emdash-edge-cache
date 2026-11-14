/**
 * Tracking parameters that newsletters, social posts and ads add to links. No page reads them, so
 * the gateway drops them before the edge cache looks up a page, and pages tell browsers to ignore
 * them too (`No-Vary-Search`). Analytics still sees them in the address bar. Cheap on purpose: it
 * runs on every request, so an address with no tag in it is left alone with one pattern match.
 */
const TRACKING_PREFIXES = ['utm_', 'mc_']
const TRACKING_NAMES = ['fbclid', 'gclid']

/**
 * The tags `No-Vary-Search` names. The header takes names, not prefixes, so this lists the common
 * ones; the gateway strips every `utm_` and `mc_` tag from the cache key.
 */
const NAMED_TAGS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'mc_cid',
  'mc_eid',
  ...TRACKING_NAMES,
]

/** The `No-Vary-Search` value for pages: a structured-field inner list. */
export const NO_VARY_SEARCH = `params=(${NAMED_TAGS.map((name) => `"${name}"`).join(' ')})`

const MAY_HAVE_TAG = /[?&](?:utm_|mc_|fbclid|gclid)/

function isTracking(name: string): boolean {
  return (
    TRACKING_NAMES.includes(name) || TRACKING_PREFIXES.some((prefix) => name.startsWith(prefix))
  )
}

/** The URL without its tracking parameters; any other parameters keep their order. */
export function withoutTrackingParams(url: URL): URL {
  if (!MAY_HAVE_TAG.test(url.search)) return url
  const stripped = new URL(url)
  for (const name of new Set(stripped.searchParams.keys())) {
    if (isTracking(name)) stripped.searchParams.delete(name)
  }
  return stripped
}

/**
 * A redirect's target with the tracking parameters of the request that led to it put back, so a
 * tagged link that redirects (an old path) keeps its tags for analytics. Targets on other sites
 * are left alone.
 */
export function withTrackingParamsOf(target: URL, request: URL): URL {
  if (target.origin !== request.origin) return target
  const tagged = new URL(target)
  for (const [name, value] of request.searchParams) {
    if (isTracking(name) && !tagged.searchParams.has(name)) tagged.searchParams.append(name, value)
  }
  return tagged
}
