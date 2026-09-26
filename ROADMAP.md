# Roadmap

- [x] Handle Task Completion
- [x] Deno 2 Migration (from pnpm/nodejs)
- [x] Navigation Pane
  - [x] Implement Navigation Pane
  - [x] Show Child Nesting in Navigation Pane
- [ ] Improve Local Storage Model
  - [x] Implement verifiable auto-save on local storage
  - [ ] Test thoroughly on chromium-base, firefox, and safari
- [ ] Investigate cloud-backed up storage
- [x] YAML Repair Tool
- [x] Tech Debt Review
  - [x] Pass one - dead code cleanup (Rust exports, wasm bridge, types, CSS)
  - [ ] Pass two - App.tsx split (deferred)
  - [x] Pass three - initiate a thorough re-review of tech debt
- [x] Merge bottom and top menu bar to the top
- [x] Improve Default View
- [x] Remove NPM Dependency
- [x] Add Frontend Tests
- [x] Improve dev experience around linting
- [x] Fact Check: Graph Algo
- [x] Fact Check: node_modules decomm not possible
- [ ] Manually re-review all tests for quality and purpose, smh
- [x] New experience is broken, no graph is loaded. Need to start with one node.
- [x] Navigation pane isn't working when not at 100% zoom
- [x] Make Taskman installable as a PWA
  - [x] Icon set: rasterized PNGs (192/512/maskable + apple-touch) from favicon.svg, committed
  - [x] `manifest.webmanifest` with relative `start_url`/`scope` (works under the `/taskman/` Pages subpath)
  - [x] Zero-dependency service worker: build-time revision map (SHA-256 via crypto.subtle), precache app shell, cache-first with runtime fill
  - [x] SW registration + install/update UX (menu entry, update toast)
  - [x] Standalone polish: `viewport-fit=cover` + safe-area insets, meta theme-color synced to active theme
  - [x] README: PWA/install docs
  - [x] E2E: CDP-driven install/offline tests in `frontend/e2e/` (boot, localStorage, SW precache, offline reload)


## build a yaml repair tool - may be delusional or non-issue

give an example of how you can use a model to parse the schema and do repairs.

## Technical Debt — Cleanup Pass (Principle Audit Findings)

The project lives well to its principles (lean dependencies, offline-first,
static deployable). This pass cleaned organizational debt, not architectural
bloat. No TODO/FIXME markers, no stray console statements, minimal Rust deps
(4), dual linting intact.

**Items:**

- **Split `App.tsx` (~1108 lines)** — Handles 6+ concerns: state management
  (10 separate `useState` calls), file I/O (`loadYaml`, open/new/save/load-sample),
  workspace persistence (debounced localStorage + mount restore), node CRUD
  (edit/add/delete handlers), menu UI (~260 lines of inline dropdown JSX), and
  header bar composition. Already extracted: `useTheme` and `useAutoSave` hooks.
  **Recommended extraction order:**
  1. `useWorkspace` hook — consolidates file I/O, persistence, debounced save,
     mount restore (~200 lines of logic)
  2. `useNodeOperations` hook — edit/add/delete handlers + `saveGraphAndUpdate`
     (~100 lines)
  3. `TopBar` component — entire header bar with menu dropdown (~430 lines of
     inline JSX/styles)
  4. `AboutModal` component — standalone help modal (~75 lines)
  Target: reduce App.tsx to ~400–500 lines. _(deferred)_

- **Inline style duplication** — Hover toggle pattern and modal backdrop pattern
  repeat across ~5 components. Known trade-off of zero-CSS design; shared
  primitives would emerge naturally during App.tsx split. _(low priority)_

## Security Hardening — Unresolved ?Low? Risk Items (SecOps Audit Findings)

- [ ] **Replace `unwrap()` with `.expect()` in Rust graph code** (`ichor/src/graph/mod.rs` lines 192, 245, 358, 360, 374) — Bare `.unwrap()` calls will panic if internal graph state becomes inconsistent. In WASM this propagates to JS with stack traces that expose function names and memory layout. With `strip = true` now enabled this is mitigated, but `.expect("context")` is still better practice for debugging. _(low priority)_

- [x] **Pin exact dependency versions in `deno.json`** — DONE (2026-09): all npm/JSR specifiers in `frontend/deno.json` are now exact pins (no `^`/`~`, no unversioned `npm:`/`jsr:` refs), matching the committed `deno.lock`. Also pinned: `ichor/Cargo.toml` direct deps (`=` exact, matching `Cargo.lock`), CI tool versions in both workflows (Deno `2.9.7`, wasm-pack `0.15.0`, GitHub Actions by commit SHA), and the Rust compiler via `rust-toolchain.toml` (`1.95.0`). A refresh is now a no-op unless a pin is deliberately changed.

- [ ] **Add `robots.txt`** (`frontend/public/`) — Search engines may index the GitHub Pages deployment. Low risk for a public tool, but worth considering if you don't want it indexed. _(low priority)_

- **Add `ichor/pkg/` to `.gitignore`** — `wasm-pack build` output (`ichor_bg.wasm`, glue JS) lands in `ichor/pkg/`, which is NOT gitignored (`frontend/public/dist/` is, but the source location isn't). Anyone who builds locally can accidentally commit WASM binaries. One-line fix. _(low priority)_

- ~~**Document WASM build as deploy prerequisite**~~ — **Stale (verified 2026-09-18):** the claim "CI now builds WASM but doesn't deploy" is wrong — `.github/workflows/static.yml` builds WASM, vendors it, and deploys `frontend/public/` to Pages. Residual kernel: *manual* deploys to other static hosts still require `wasm-pack build` + `deno task vendor-wasm` first, or the app ships without its brain and fails silently. Worth one line in the README "Other Static Hosts" section. _(low priority)_

## README Inaccuracies (found during PWA study, 2026-09-18)

- Project Structure section shows `Sample.yaml` and `DATA_MODEL.md` at repo root; both actually live at `frontend/public/sample.yaml` and `docs/DATA_MODEL.md`. The root copy of `Sample.yaml` doesn't exist.
- `frontend/src/assets/hero.png`, `frontend/src/assets/react.svg`, and `frontend/public/icons.svg` (SVG sprite with bluesky/github symbols) are unreferenced by any source file (verified by grep across src/docs/html/css/md) — dead assets, safe to delete per the "verify with grep before deleting" rule.

## Documentation Drift (from docs/ review, 2026-09-18)

- `docs/REINGOLD-TILFORD.md` is background reading, **not** a spec for the current layout engine. Describes the academic version (contours, threaded pointers, two-pass with `shift`/`change` bookkeeping). The actual TS implementation uses a bounding-box heuristic — justified by the constraint that X=depth means nodes in different columns can't overlap. The June bugfix doc (`records-pain/layout-y-axis-spacing.md`) is the authoritative reference. One-line pointer clarification would prevent future agent confusion.

- The test-coverage inventory (`docs/records-pain/test-coverage-inventory.md`) accurately tracks 89 tests across 4 files. Its "Coverage Gaps" section is the authoritative source for what is NOT tested (React components, WASM boundary). **PWA implication (resolved 2026-09-25):** the SW/install surface now HAS automated coverage — `frontend/e2e/` runs 3 CDP-driven tests in headless Edge (boot, localStorage persistence, SW precache + offline reload). React component rendering remains the untested gap.
