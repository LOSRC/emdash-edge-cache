# Changelog

Every change a deploy tool should be able to require bumps the version (see "Releasing" in the
README). Sites pin a commit; the version is what a tool compares.

## 0.1.1

- A `/_image` 304 is no longer kept at the edge: only a 200 gets the hour, anything else is
  `no-store`. What Workers Cache does with a body-less 304 on a key it has not stored is not
  documented.
- The README's `allowBuilds` key is the one pnpm 11.28.4 accepts.
- CI runs typecheck, tests and build on pull requests and main.

## 0.1.0

- First release: gateway, `Site` entrypoint, outer middleware, route rules, page cache.
