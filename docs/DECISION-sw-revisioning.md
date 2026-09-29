# Design Decision: Hand-Rolled SW Revisioning (No Workbox)

**Date:** 2026-09-26
**Status:** Accepted — owned infrastructure, guarded by e2e
**Relates to:** `frontend/public/sw.js`, `frontend/gen-revision.ts`,
`frontend/e2e/e2e.test.ts`, `docs/records-pain/pwa-e2e-harness.md` (Bug 5)

## Context

Taskman's build emits **stable filenames** (`dist/main.js`, not
`main.<hash>.js`) — a deliberate choice to keep the esbuild build simple and
the Pages artifact plain. A cache-first service worker over stable
filenames serves the old shell forever unless something changes per build.
The standard industry answer is Workbox (+ `workbox-build`/
`InjectManifest`), which generates a precache manifest at build time.

Taskman's first principle is "as few dependencies as possible; if an
opportunity arises to aim lower, I will." Workbox would have been the only
third-party runtime dependency in the deployed bundle and a build-time dev
dependency besides.

## Decision

Own the mechanism instead: a ~100-line hand-rolled `sw.js` plus a
`gen-revision.ts` build step that

1. hashes every shell file with SHA-256 (`crypto.subtle` — no deps),
2. emits `dist/cache-manifest.js` (`self.CACHE_MANIFEST = { buildId, files }`),
3. **stamps the `buildId` into the main `sw.js`** as `const BUILD_ID`,
4. names the cache `taskman-shell-<buildId>` and deletes every other cache
   on activate.

The stamp (step 3) is load-bearing: Chromium's SW update check
byte-compares only the **main** script, so a changed `importScripts`'d
manifest alone triggers nothing. Shipping without the stamp silently pins
every install to the first build it ever fetched — exactly the bug found
post-demo on Windows (records-pain, Bug 5).

## Consequences

**Accepted costs — this is owned infrastructure now:**

- Any change to precaching, update flow, or the build pipeline must
  maintain this code by hand rather than picking up upstream Workbox fixes.
- The stamp invariant (sw.js `BUILD_ID` == manifest `buildId`) must hold on
  every build; a regression here is *silent* (no error, just no updates).
- The `deno fmt` interaction (the stamped line can be re-wrapped) is
  handled by a whitespace-tolerant regex in `gen-revision.ts` — another
  small thing to know about.

**Mitigations:**

- The e2e suite asserts the stamp matches the manifest on every run, and
  the SW itself throws at install on mismatch — the silent failure mode is
  now a loud one.
- The whole mechanism is ~100 lines of plain JS readable in one sitting,
  versus Workbox's ~300 KB minified runtime.
- `updateViaCache: "none"` registration plus the stamp covers both
  sw.js-freshness and shell-freshness without caching-library semantics.

**Why not Workbox, concretely:** it would add the project's first runtime
third-party dependency, an opinionated caching layer whose behavior we'd
have to learn and debug, and a build plugin — to replace a mechanism that
fits in one screen and whose single hard failure mode we've already hit,
fixed, and pinned with a test. If the SW ever grows real complexity
(background sync, offline mutation queues, ranged caching), revisit this
decision rather than extending the hand-rolled file past its simplicity.
