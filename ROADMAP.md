# Roadmap

## Handle Task Completion — Done vs Delete

**Status:** Punted (pending design decision)

Marking a task as "done" is semantically equivalent to deleting it from the active graph, but carries different user intent. A deleted node re-maps its children to its parent(s), which may not be the desired behavior for completed tasks — users likely want to preserve completion state rather than collapse the hierarchy.

**Key tension:** Delete removes a node and adopts its children into the parent(s). Completion should probably preserve the node in some archived/completed state, or at least distinguish itself visually and logically from a hard delete.

**Next steps:** Decide whether "done" is a flag on the node (e.g., `completed: true`), a separate view/filter, or a distinct graph operation that doesn't re-map children.


## Add navigation pane
The navigation pane will allow you to three views
1. a list of all node children (tasks with no subtasks) that are ready to be worked
2. all tasks marked important
3. all tasks near deadline (user configurable but defaults to 14 days)

## Improve the storage model
when working from the sample file, no changes are tracked, when working from new or opening a pre-existing file, we will clearly indicate the file being tracked. we will auto-save changes async to file.

## build a yaml repair tool
if files get corrupted and therefore cannot be loaded into the graph, we should have a non-destructive method of auto-repair.

## design icon and the web presence
the default "frontend" with the lightning bolt isn't cool enough


## Technical Debt — Cleanup Pass (Principle Audit Findings)

**Status:** Ready

The project lives well to its principles (lean dependencies, offline-first, static deployable). The remaining debt is organizational cleanup, not architectural bloat.

**Items:**

- **Split `App.tsx` (1109 lines)** — Handles 6+ concerns: state management, file I/O, menu logic, theme switching, help modals, and node CRUD. Extract custom hooks (file ops, workspace persistence) and narrow components.
- **Remove `add(left, right)` boilerplate** — Default wasm-pack template stub in `ichor/src/lib.rs:28-30`. Unused.
- **Consolidate duplicate Rust API exports** — `lib.rs` re-exports both `node_count` (from yaml) and `get_node_count` (from graph), same for `root_names` / `get_root_names`. Keep one of each.
- **Remove unused Vite template CSS** — `frontend/src/App.css` contains leftover `.counter`, `.hero`, `#center`, `#next-steps` classes from the Vite + React template. Delete or strip.
- **Fix `// eslint-disable` in ThemeModal** — `frontend/src/components/ThemeModal.tsx` has a silenced `set-state-in-effect` rule. Refactor the effect to remove the need for the disable comment.
- **Review Rust edition 2024** — `ichor/Cargo.toml` uses edition 2024 which is bleeding-edge and may cause friction with older toolchains. Consider 2021 for broader compatibility.
- **Sample YAML hierarchy quirk** — `frontend/public/sample.yaml` node 14 (`Implement Pan & Zoom`) lists `subtask_ids: [12]` (Integration Tests), which creates an unexpected cross-branch parent-child link. Verify this is intentional or fix.

## think about some of the default views
The "reset" view location isn't very good, need to figure out better node spacing and default views.
