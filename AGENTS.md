# AGENTS.md — Agent Working Rules for Taskman

These are the principles any agent (AI or human) must uphold when working in
this repository. They encode the project's philosophy and the hard-won
lessons from past sessions. Violations have historically shipped real bugs
(see the linked `docs/records-pain/` entries).

## Design Principles

1. **As few dependencies as possible.** Currently: rust, typescript, deno,
   esbuild, react. If an opportunity arises to aim lower, take it. Never add
   a third-party package when the platform provides the primitive
   (e.g. `crypto.subtle` instead of a hashing lib; raw CDP instead of
   Playwright; canvas rasterization instead of sharp/resvg; hand-rolled SW
   instead of Workbox). All dependency versions are exact-pinned — a
   refresh is a no-op unless a pin deliberately changes.
2. **As simple as possible.** Prefer a small transparent mechanism over an
   opaque dependency. New code should match the style of what's already
   there (hooks live in `frontend/src/hooks/` with the `useTheme`/
   `useAutoSave` shape; UI is inline-style, zero-CSS-framework).
3. **Offline-first, privacy by design.** Data stays on the user's machine;
   no backend, no analytics, no runtime code fetched from the network. Any
   new feature must work with zero network after first load.
4. **Idiomatic rust, idiomatic typescript.** No drive-by refactors — touch
   only what the task needs.

## Verification Rules (mandatory before claiming done)

- Frontend: `cd frontend && deno fmt && deno task lint && deno task test`
- Rust: `cd ichor && cargo fmt && cargo clippy --all-targets -- -D warnings && cargo test`
- Browser e2e (PWA/shell-affecting changes): `cd frontend/e2e && deno task test`
  — headless Edge via CDP; proves the service worker precaches the shell
  and serves it offline. Build integrity is asserted there too (stamped
  `sw.js` `BUILD_ID` must equal `dist/cache-manifest.js`'s `buildId`).
- Full build: `cd frontend && deno task build` (vendors WASM, bundles, and
  runs `gen-revision` — the step that stamps the SW cache revision).

**Prefer fixing over silencing** — remove dead code instead of adding
suppression comments. A lint allow is a last resort and must carry an
inline justification (see the two `too_many_arguments` allows on the
wasm-bindgen `add_node` ABI).

## Windows / Deno Path Rules (learned the hard way — see
`docs/records-pain/pwa-e2e-harness.md`)

- Resolve file paths by **plain string join from an NT-style root** — never
  `new URL(rel, root)` for request paths, and never trust `URL.pathname`
  without a colon-aware normalizer (`/C:/...` ≠ `/c/...`).
- **`terminal` (git-bash) and file tools resolve relative paths
  differently.** Always pass absolute paths to `write_file`/`patch`/`read_file`.
  Never `cd` in `terminal` and then use relative tool paths — that is how
  phantom nested directories get created.
- e2e module runs with `--no-check` and its own `deno.json`
  (`frontend/deno.json` excludes `e2e/`); don't shoehorn Deno-only files
  into the frontend TS module graph.
- A failed `Runtime.evaluate` is silent — exceptions land in
  `exceptionDetails` while `result.value` reads `undefined`, so a broken
  predicate presents as a *timeout*, not an error.

## PWA Rules (if touching `sw.js`, `gen-revision.ts`, or the manifest)

- **Chromium's SW update check byte-compares only the MAIN `sw.js` script.**
  A changed `importScripts`'d manifest alone triggers nothing. Therefore
  `gen-revision.ts` MUST stamp the `buildId` into `sw.js` itself
  (`const BUILD_ID = "…"`, whitespace-tolerant regex — `deno fmt` wraps the
  line). Removing the stamp re-breaks shell updates silently.
- All manifest and SW paths stay **relative** (`./`) — the app deploys under
  a GitHub Pages subpath (`/taskman/`).
- `any`-purpose icons keep transparent backgrounds; maskable and
  apple-touch must be opaque (Android circle-crops; iOS composites over
  black). Regenerate with `deno task gen-icons` (root task) after any
  `favicon.svg` change, and commit the PNGs — CI has no browser to
  rasterize them.
- Icon/background colors come from the app's own theme palette
  (banana-crisis `--bg-secondary` `#fff9c4` = manifest `theme_color`).

## Documentation Rules

- Post-mortems go in `docs/records-pain/` matching the house format:
  Problem → Context → Numbered bugs with diffs → Tests added → Takeaways.
  Update the doc when a later session invalidates an entry rather than
  deleting it (mark resolved/stale with a dated note).
- Audit claims in `ROADMAP.md` are dated snapshots — re-verify a claim by
  grepping the live tree before acting on it; when stale, mark it
  resolved/stale with the date, don't remove the history.
- README changes that move content into `docs/` must leave a pointer and
  no dangling anchors.

## Repo Hygiene

- Never commit, push, or rewrite history unless explicitly asked — the
  user manages all commits.
- Never read, print, or commit secrets; leave `.env` and credential files
  alone.
- Build outputs: `frontend/public/dist/` and `ichor/pkg/` are gitignored
  (wasm-pack also self-ignores `ichor/pkg/`, but that file is transient —
  the root `.gitignore` rule is the durable one).
- Scratch/probe scripts created during debugging are deleted before the
  work is handed back; only harness files that a task or test references
  survive (e.g. `gen_icons.ts`, `test_server.ts`).
