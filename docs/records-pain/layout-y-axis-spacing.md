# Layout Engine Y-Axis Spacing Fix

**Date:** 2026-06-04  
**Files:** `frontend/src/engine/layout.ts`, `frontend/src/engine/__tests__/layout.test.ts`  
**Status:** ✅ Resolved — 17/17 tests pass, zero diagnostics

---

## Problem Statement

Y-axis overlaps between sibling nodes in the Reingold-Tilford layout engine. The X-axis (depth-based) spacing was correct, but Y positions conflicted — particularly affecting:
- Depth=2 children of parents with many siblings
- "First child of many" patterns where a parent's first child overlapped previous siblings' subtrees

---

## Algorithm Context

The layout uses a **two-pass Reingold-Tilford variant** adapted for left-to-right trees (X = depth, Y = RT position):

1. **`firstWalk` (bottom-up):** Computes relative `prelim` positions, accumulates sibling spacing offsets in a `shift` field without mutating absolute coordinates
2. **`applyShifts` (top-down):** Propagates accumulated shifts and finalizes absolute Y positions

Each node carries per-layout state:
```ts
interface RT {
  prelim: number; // Relative Y position (computed during firstWalk)
  depth: number;  // Depth from root (0 = root)
  minY: number;   // Top edge of subtree (relative to this node's prelim origin)
  maxY: number;   // Bottom edge of subtree (relative to this node's prelim origin)
  shift: number;  // Accumulated shift from ancestor spacing constraints
}
```

**Critical invariant:** `minY`/`maxY` are stored **relative to each node's own `prelim` origin**, not absolute. A node's true extent in any ancestor frame is:

```
true_top    = ancestorShift + shift + prelim + minY
true_bottom = ancestorShift + shift + prelim + maxY
```

---

## Bugs Found (3)

### Bug 1: Missing `prelim` in Sibling Spacing

**Location:** `ensureSiblingSpacing()` — L291-294  
**Symptom:** Siblings with non-zero `prelim` got insufficient spacing → overlaps

The true-position calculation omitted `prelim`, treating `minY`/`maxY` as absolute rather than relative to the node's origin:
```diff
  const earlierTrueBottom = ancestorShift + earlierRT.shift +
-   earlierRT.maxY;
+   earlierRT.prelim + earlierRT.maxY;

  const laterTrueTop = ancestorShift + laterRT.shift +
-   laterRT.minY;
+   laterRT.prelim + laterRT.minY;
```

### Bug 2: Parent Bounds Exclude Self Height

**Location:** `firstWalk` step 4 (subtree bounds caching) — L253-262  
**Symptom:** Tall parents with short children had undersized bounding boxes → adjacent siblings overlapped the parent node itself

The subtree bounds scan started from empty (`Infinity`/`-Infinity`) and only considered children's extents. A leaf correctly sets `minY=0, maxY=h`, but internal nodes were missing this invariant — their own height was excluded:
```diff
  const r = this.rt.get(nodeId)!;
+ const selfH = this.estimateNodeHeight(node);
  const parentPrelim = r.prelim;
- let subtreeMin = Infinity,
-   subtreeMax = -Infinity;
+ let subtreeMin = 0,
+   subtreeMax = selfH; // Start with the node's own extent
```

**Why this matters:** Node "Create Graph Renderer" has details+deadline (tall) but only one short child. Without including its own height, `maxY` was too small, and sibling spacing let the next sibling ("Implement Layout Engine") overlap it.

### Bug 3: Missing `prelim` in Multi-Root Spacing

**Location:** `computeLayout()` multi-root loop — L115, L120  
**Symptom:** Multiple roots could overlap when their subtrees had non-zero prelim offsets
```diff
- const prevBottom = prevRT.maxY + prevRT.shift;
+ const prevBottom = prevRT.prelim + prevRT.shift + prevRT.maxY;

- const currTop = currRT.minY + currRT.shift;
+ const currTop = currRT.prelim + currRT.shift + currRT.minY;
```

---

## Tests Added (3)

| Test | What it catches |
|---|---|
| `no same-depth overlaps (many siblings)` | Exhaustive check across all depth levels with multiple parents, each having many children at the same depth |
| `first child of many no overlap` | First child of a large sibling group doesn't overlap previous siblings' subtrees — targets the specific "first child offset weird" pattern |
| `parent bounds include self height` | Tall parent with short child still reports correct bounding box to prevent sibling overlap — regression test for Bug 2 |

---

## Key Takeaways

1. **The invariant is non-negotiable:** Every use of `minY`/`maxY` must include `prelim` in the true-position calculation. The bounds are relative offsets, not absolute positions.
2. **Subtree bounds = self ∪ children:** Always initialize bounds with the node's own extent `[0, h]`, then expand to include children. This matches how leaf nodes work and prevents undersized bounding boxes for tall parents.
3. **Bounding-box spacing is sufficient here:** In our L→R layout (X=depth), nodes at different depths are on separate columns and can't visually overlap. Full contour scanning (as in classic RT) is unnecessary — corrected bounding boxes guarantee no same-depth collisions.
4. **O(n) complexity preserved:** No structural changes to the algorithm — only corrected arithmetic in existing calculations.
