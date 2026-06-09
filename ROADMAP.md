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
