# Test Coverage Inventory

Generated: 2026-06-04 | Updated: 2026-06-05 (Layout edge cases, useTheme logic, delete+create sequencing)

## Summary

| Module | File | Count | What it covers |
|--------|------|-------|----------------|
| **Rust Graph Logic** | `ichor/src/graph/mod.rs` | 46 tests | CRUD operations, YAML parsing edge cases, GraphBuilder conversion, adjacency invariants, delete+create sequencing |
| **Layout Engine** | `frontend/src/engine/__tests__/layout.test.ts` | 21 tests | Tree layout algorithm — positioning, spacing, overlap avoidance, empty graph, mixed collapse states, DAG shared children, re-computation |
| **useAutoSave Hook** | `frontend/src/hooks/__tests__/useAutoSave.test.ts` | 8 tests | Pure helper `deriveBaseStatus()` only (all 8 boolean input combos) |
| **useTheme Logic** | `frontend/src/hooks/__tests__/useTheme.test.ts` | 13 tests | Theme configuration constants, data integrity, `getThemeLabel` pure function, cycling order |

**Total: 88 tests across 4 files.**

---

## Rust Graph Logic (`ichor/src/graph/mod.rs`) — 43 Tests

### Delete (8 tests)

| # | Test Name | What it verifies |
|---|-----------|-----------------|
| 1 | `test_delete_non_root_node_basic` | Deleting a middle node in a chain (A→B→C) remaps children to parents. Verifies adjacency, parent_ids, and root status after deletion. |
| 2 | `test_delete_root_node_rejected` | Deleting a root node returns an error with "Cannot delete root node" message. |
| 3 | `test_delete_nonexistent_node` | Deleting a non-existent ID (999) returns an error containing "not found". |
| 4 | `test_delete_remapping_children_to_all_parents` | DAG diamond pattern: deleting C (shared by A and B) remaps D to both A and B. Verifies no duplicate parent references. |
| 5 | `test_delete_node_with_multiple_parents` | Complex DAG where a deleted node's children already have other parents — verifies deduplication of parent/subtask references. |
| 6 | `test_delete_leaf_node` | Deleting a leaf removes it from the graph and cleans up the parent's subtask_ids and adjacency lists. |
| 7 | `test_delete_middle_of_deep_chain` | Deleting C in chain A→B→C→D→E remaps D to B, preserving the chain structure. |
| 8 | `test_delete_updates_adjacency_correctly` | Deleting a node with multiple children (A→B→{C,D}) remaps both children to A and fully removes B from adjacency/reverse_adjacency maps. |

### Create / Add Node (9 tests) — +3 new, 6 enhanced

| # | Test Name | What it verifies |
|---|-----------|-----------------|
| 9 | `test_create_first_node_in_empty_graph` | Adding the first node to an empty graph gives id=1, marks it as root, no parents. **Also asserts `collapsed == Some(false)`.** |
| 10 | `test_create_child_node` | Adding a child under an existing parent auto-increments ID, updates parent's subtask_ids and child's parent_ids bidirectionally. **Also verifies adjacency HashMap, reverse_adjacency, and collapsed default.** |
| 11 | `test_create_node_with_full_fields` | Creating a root node with all optional fields (details, deadline, important) preserves them correctly. **Also asserts `done == None` when not provided.** |
| 12 | `test_create_node_fails_with_invalid_parent` | Adding under non-existent parent ID returns an error mentioning the bad ID; graph is unchanged. |
| 13 | `test_create_node_auto_id_skips_existing_ids` | Auto-ID uses max+1 (not gap-filling). With IDs {1, 3}, new node gets 4. |
| 14 | `test_create_node_with_subtask_ids` | Creating a node with explicit subtask_ids updates reverse_adjacency for the children. **Also verifies the new node's own adjacency entry.** |
| 15 | `test_create_node_with_done_field` *(new)* | Creates nodes with `done=true`, `done=false`, and `done=None` — verifies all three states persist correctly on create. |
| 16 | `test_create_multiple_roots` *(new)* | Adds two root nodes via `add_node` and verifies both are in `root_ids` with no parents. |
| 17 | `test_create_with_nonexistent_subtask_ids` *(new)* | Documents that `add_node` does NOT validate subtask targets — it blindly updates reverse_adjacency even for non-existent IDs (intentional for YAML out-of-order node creation). |

### Read (6 tests)

| # | Test Name | What it verifies |
|---|-----------|-----------------|
| 18 | `test_read_get_node_existing` | `get_node()` returns correct node by ID. |
| 19 | `test_read_get_node_missing` | `get_node()` returns None for non-existent ID. |
| 20 | `test_read_get_children` | `get_children()` returns all children of a parent node. |
| 21 | `test_read_get_children_leaf` | `get_children()` on a leaf returns empty list. |
| 22 | `test_read_get_parents` | `get_parents()` returns both parents for a shared child in a DAG. |
| 23 | `test_read_get_parents_root` | `get_parents()` on a root returns empty list. |

### Update (3 tests) — +1 new, 2 enhanced

| # | Test Name | What it verifies |
|---|-----------|-----------------|
| 24 | `test_update_node_fields` | Direct mutation of **all scalar fields** (name, details, deadline, important, done, collapsed) via `get_node_mut()` persists correctly. *(was: name, details, important only)* |
| 25 | `test_update_node_add_subtask_field` | Mutating subtask_ids field is writable. **Asserts adjacency is NOT auto-updated** (was: comment-only). |
| 26 | `test_update_mutation_then_delete_uses_stale_adjacency` *(new)* | Raw-mutate a node's `subtask_ids`, then delete another child — confirms `delete_node` operates on adjacency maps, not mutated fields. Documents the dangerous interaction between raw mutation and graph operations. |

### Serialization / Roundtrip (3 tests)

| # | Test Name | What it verifies |
|---|-----------|-----------------|
| 27 | `test_read_json_roundtrip` | Graph → JSON → Graph preserves node count and names. |
| 28 | `test_yaml_roundtrip_preserves_node_data` | YAML → Graph → YAML roundtrip preserves all fields (name, details, deadline, important, subtask_ids). |
| 29 | `test_done_field_roundtrip` | The `done` field parses correctly (true/false/None) and survives a full YAML roundtrip. |

### GraphBuilder Conversion (4 tests) — new section

Direct unit tests for `GraphBuilder::nodes_from_yaml()` conversion logic:

| # | Test Name | What it verifies |
|---|-----------|-----------------|
| 30 | `test_nodes_from_yaml_empty_subtask_vec_becomes_none` | YAML Node with `subtask_ids: []` → GraphNode has `subtask_ids: None` (not `Some(vec![])`) |
| 31 | `test_nodes_from_yaml_non_empty_subtask_preserved` | `subtask_ids: [2, 3]` → `Some(vec![2, 3])` |
| 32 | `test_nodes_from_yaml_collapsed_always_defaults_to_false` | Regardless of input, GraphNode gets `collapsed: Some(false)` |
| 33 | `test_nodes_from_yaml_all_fields_mapped` | Full Node with every field (id, name, details, deadline, important, done) maps to matching GraphNode fields; parent_ids is always None from YAML |

### YAML Parsing Edge Cases — Error Handling (5 tests) — new section

| # | Test Name | What it verifies |
|---|-----------|-----------------|
| 34 | `test_yaml_parse_empty_string_fails` | `""` → parse error (not panic, not empty graph) |
| 35 | `test_yaml_parse_missing_nodes_key_fails` | `{garbage: true}` → parse error — `nodes:` key is required |
| 36 | `test_yaml_parse_malformed_fails` | Bad indentation / unclosed structures → parse error with descriptive message |
| 37 | `test_yaml_parse_empty_nodes_list_succeeds` | `nodes: []` → valid empty graph (0 nodes, 0 roots) — valid "new project" state |
| 38 | `test_yaml_parse_node_missing_name_fails` | Node without `name` field → parse error (required by struct) |

### YAML Parsing Edge Cases — Data Integrity (3 tests)

| # | Test Name | What it verifies |
|---|-----------|-----------------|
| 39 | `test_yaml_parse_duplicate_node_ids` | Two nodes with same `id` — serde allows this; both in parsed list (dedup is graph layer's job, not parser's) |
| 40 | `test_yaml_parse_subtask_refs_nonexistent_node` | Node references subtask ID that doesn't exist — parses fine (validation belongs to graph layer) |
| 41 | `test_yaml_parse_large_subtask_list` | Node with 100 subtask_ids — no truncation or overflow |

### Delete + Create Sequencing (3 tests) — new section

Compound operations that verify graph integrity after delete followed by create:

| # | Test Name | What it verifies |
|---|-----------|-----------------|
| 42 | `test_delete_child_then_add_replacement` *(new)* | Delete child B from parent A, then add replacement D under A. Verifies no ghost references to B in adjacency or subtask_ids; C and D both present. |
| 43 | `test_delete_and_create_in_diamond` *(new)* | Diamond DAG (Root→{A,B}→D): delete A, verify D remapped to Root via reverse_adjacency, then add E under D. Confirms adjacency stays consistent through compound ops. |
| 44 | `test_add_node_after_delete_preserves_root_ids` *(new)* | Delete only child of a root → root_ids unchanged → add new child → root_ids still `[1]`. Verifies bidirectional links (parent→child, child→parent) are correct after the sequence. |

---

## Layout Engine (`frontend/src/engine/__tests__/layout.test.ts`) — 21 Tests

| # | Test Name | What it verifies |
|---|-----------|-----------------|
| 1 | `single leaf node` | Single root with no children positions at (0, 0). |
| 2 | `root with two children` | Root centered between two children on Y-axis; children share same X depth; child B is below child A. |
| 3 | `multiple roots` | Three independent roots all at depth 0, stacked vertically with spacing. |
| 4 | `back-edge handling` | Cyclic reference (A→B and B→A) doesn't crash layout; both nodes positioned correctly. |
| 5 | `collapsed hides children` | Collapsed parent only renders itself in the layout — children are excluded from node count. |
| 6 | `undefined collapsed defaults to hidden` | When `collapsed` is undefined (default), children are treated as hidden. |
| 7 | `getLayoutBounds - basic` | Bounding box calculation returns positive width/height with valid min/max bounds. |
| 8 | `getLayoutBounds - empty` | Empty layout returns all-zero bounds. |
| 9 | `edge collection` | Layout edges match expanded parent→child relationships (2 edges for root with 2 children). |
| 10 | `variable node height` | Nodes with details+deadline are taller than simple nodes. |
| 11 | `setConfig` | Custom horizontalSpacing config is respected in computed layout. |
| 12 | `clearCache` | Clearing cache and recomputing produces valid results. |
| 13 | `deep nesting` | 4-level deep chain positions at correct depth multiples (280, 560, 840). |
| 14 | `shift propagation to grandchildren` | When a sibling shifts to avoid overlap, its children also shift. Verifies grandchild Y positions and parent centering. |
| 15 | `no same-depth overlaps (many siblings)` | Exhaustive pairwise check: no two nodes at the same depth overlap on Y-axis across a complex multi-parent tree. |
| 16 | `first child of many no overlap` | When a parent has many children, the first child doesn't overlap with previous sibling subtrees. Verifies vertical gap ≥ 32px. |
| 17 | `empty graph layout` *(new)* | Zero-node graph produces empty Map and zero edges without crashing. |
| 18 | `mixed collapsed/expanded subtrees` *(new)* | Root expanded → child A **collapsed** (hides grandchildren) + child B **expanded** (shows great-grandchildren). Only 5 of 7 nodes positioned; hidden children excluded from layout Map. |
| 19 | `re-computation after graph mutation` *(new)* | Same engine instance: compute layout for graph-1 → `setGraph(graph-2)` → recompute. Verifies all stale nodes and edges are fully cleared; no cross-contamination between layouts. |
| 20 | `DAG shared child (diamond)` *(new)* | Diamond pattern (Root→A,B; A→C, B→C): all 4 nodes positioned once; shared child C at correct depth-2 X position. No infinite loop or duplicate positioning. |
| 21 | `parent bounds include self height` | Tall parents (with details+deadline) correctly factor their own height into bounding box calculations to prevent sibling overlap. |

---

## useAutoSave Hook (`frontend/src/hooks/__tests__/useAutoSave.test.ts`) — 8 Tests

All test `deriveBaseStatus(supported, enabled, hasHandle)` — a pure state machine function:

| # | Test Name | Inputs → Expected Output |
|---|-----------|------------------------|
| 1 | `unsupported when API not available` | `(false, true, true) → "unsupported"` |
| 2 | `disabled when auto-save is off` | `(true, false, true) → "disabled"` |
| 3 | `disabled when no handle tracked` | `(true, true, false) → "disabled"` |
| 4 | `idle when everything is ready` | `(true, true, true) → "idle"` |
| 5 | `unsupported takes priority over enabled=false` | `(false, false, true) → "unsupported"` |
| 6 | `unsupported takes priority over all false` | `(false, false, false) → "unsupported"` |
| 7 | `disabled when enabled=false and no handle` | `(true, false, false) → "disabled"` |
| 8 | `unsupported when enabled=true, handle=false` | `(false, true, false) → "unsupported"` |

**Not tested (documented as impossible in Deno):** React hook lifecycle, IndexedDB persistence, File System Access API, permission flow, debounce timing, download fallback, localStorage helpers. The file includes a manual testing checklist for these.

---

## useTheme Logic (`frontend/src/hooks/__tests__/useTheme.test.ts`) — 13 Tests

Constants and pure-function logic. `getThemeLabel` was moved from the React hook to `themeConstants.ts` so it can be tested without pulling in the React runtime.

| # | Test Name | What it verifies |
|---|-----------|-----------------|
| 1 | `STORAGE_KEY_THEME is correct` | Key equals `"taskman_theme"`. |
| 2 | `STORAGE_KEY_CUSTOM is correct` | Key equals `"taskman_custom_colors"`. |
| 3 | `THEMES has 5 entries` | Exactly 5 themes defined. |
| 4 | `theme ids match expected values` | IDs are exactly: banana-crisis, manhattan-lagoon, brooding-burg, carbon-noir, monochrome-dystopia. |
| 5 | `every theme has a label` | All themes have non-empty labels. |
| 6 | `COLOR_VARIABLES has 12 entries` | Exactly 12 CSS custom properties defined. |
| 7 | `COLOR_VARIABLES starts with --` | All variable names are valid CSS custom property syntax. |
| 8 | `COLOR_LABELS covers all variables` | Every color variable has a corresponding label; counts match. |
| 9 | `specific color labels` | Spot-checks: bg-primary→"Background", text-primary→"Text", accent→"Accent", semantic-important→"Important Fill", backdrop→"Backdrop". |
| 10 | `getThemeLabel returns correct labels for all themes` *(new)* | All 5 theme IDs resolve to their expected label strings (e.g. "banana-crisis" → "Banana Crisis"). |
| 11 | `getThemeLabel returns 'Custom' for custom` *(new)* | The special `"custom"` id resolves to `"Custom"`. |
| 12 | `getThemeLabel fallback for unknown id` *(new)* | An unrecognized theme string falls back to the default label `"Banana Crisis"`. |
| 13 | `theme cycling order is deterministic` *(new)* | Full cycle: banana-crisis → manhattan-lagoon → brooding-burg → carbon-noir → monochrome-dystopia → wraps to banana-crisis. |

---

## Coverage Gaps (Updated)

### No Tests At All (Components)

The following React components have zero test coverage. Testing them would require JSDOM + react-testing-library in Deno — non-trivial setup per the ROADMAP:

- `GraphRenderer`
- `EditNodeModal`
- `DeleteNodeDialog`
- `NavigationPanel`
- `ThemeModal`

### No Tests At All (Other)

- **WASM bridge** — nothing tests the Rust ↔ TypeScript communication layer. The `#[wasm_bindgen]` functions (`build_graph_from_yaml`, `graph_to_yaml`, `add_node`, `delete_node`) are tested through Rust internals but not across the actual WASM boundary.
- **Integration / end-to-end flows** — no tests for YAML→graph→layout→render pipeline or user interaction sequences.
- **useAutoSave hook lifecycle** — only the pure `deriveBaseStatus()` helper is tested; actual React hook behavior (effects, debouncing, IndexedDB) is untested.

### Partial Coverage

- **useTheme hook lifecycle** — `getThemeLabel` and constants are now tested; the actual React hook (localStorage read/write, theme switching via DOM effects) is untested but requires JSDOM to exercise.
- **Delete tests** — compound delete+create sequencing covered; delete with concurrent field mutations not yet tested.

### Now Covered (was previously a gap)

- ~~**YAML parsing edge cases**~~ — now 12 tests covering error handling (empty string, missing key, malformed, empty list, missing required field), data integrity (duplicate IDs, nonexistent subtask refs, large lists), and GraphBuilder conversion invariants.
- ~~**Create: done/collapsed fields**~~ — now tested on create path.
- ~~**Create: adjacency map updates**~~ — now asserted for both parent→child and new node's own adjacency entry.
- ~~**Update: all scalar fields**~~ — expanded from 3 to 6 fields (added deadline, done, collapsed).
- ~~**Update: adjacency not auto-updated**~~ — comment-only note is now an actual assertion.
- ~~**Update + delete interaction**~~ — new test documents the stale adjacency behavior when raw mutation precedes deletion.
- ~~**Layout engine edge cases**~~ — empty graph layout, mixed collapsed/expanded subtrees, re-computation after mutation, and DAG shared-child (diamond) are now covered (4 new tests).
- ~~**useTheme pure logic**~~ — `getThemeLabel` moved to `themeConstants.ts` and fully tested: all theme labels, custom label, unknown fallback, cycling order (4 new tests).
