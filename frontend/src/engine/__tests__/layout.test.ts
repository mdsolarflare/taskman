import {
  createLayoutEngine,
  getLayoutBounds,
  LayoutEngine,
} from "../layout.ts";
import { assert, assertEquals } from "@std/assert";
import type { Graph, GraphNode } from "../../types/graph.ts";

/** Build a simple Graph with the given nodes and root_ids. */
function buildGraph(nodes: GraphNode[], rootIds: number[]): Graph {
  const adjacency: Record<number, number[]> = {};
  const reverseAdjacency: Record<number, number[]> = {};

  // First pass: initialize all entries
  for (const node of nodes) {
    adjacency[node.id] = [];
    reverseAdjacency[node.id] = [];
  }

  // Second pass: populate adjacency lists
  for (const node of nodes) {
    if (node.subtask_ids) {
      for (const childId of node.subtask_ids) {
        adjacency[node.id].push(childId);
        reverseAdjacency[childId].push(node.id);
      }
    }
  }

  return {
    nodes,
    adjacency,
    reverse_adjacency: reverseAdjacency,
    root_ids: rootIds,
  };
}

/** Simple single root with no children. */
Deno.test("LayoutEngine - single leaf node", () => {
  const engine = createLayoutEngine();
  const graph = buildGraph([{ id: 1, name: "Root" }], [1]);
  engine.setGraph(graph);
  const layout = engine.computeLayout();

  assertEquals(layout.nodes.size, 1);
  const node = layout.nodes.get(1);
  assert(node !== undefined);
  assertEquals(node.x, 0);
  assertEquals(node.y, 0);
});

/** Single root with two leaf children. */
Deno.test("LayoutEngine - root with two children", () => {
  const engine = createLayoutEngine();
  const graph = buildGraph(
    [
      { id: 1, name: "Root", subtask_ids: [2, 3], collapsed: false },
      { id: 2, name: "Child A" },
      { id: 3, name: "Child B" },
    ],
    [1],
  );
  engine.setGraph(graph);
  const layout = engine.computeLayout();

  assertEquals(layout.nodes.size, 3);

  const root = layout.nodes.get(1)!;
  const childA = layout.nodes.get(2)!;
  const childB = layout.nodes.get(3)!;

  // Root at depth 0, children at depth 1
  assertEquals(root.x, 0);
  assertEquals(childA.x, 280);
  assertEquals(childB.x, 280);

  // Root centered between children
  const childACenter = childA.y + childA.height / 2;
  const childBCenter = childB.y + childB.height / 2;
  const expectedRootY = (childACenter + childBCenter) / 2;
  assertEquals(root.y, expectedRootY);

  // Child B is below Child A with gap
  assert(childB.y > childA.y);
});

/** Three roots processed as separate trees. */
Deno.test("LayoutEngine - multiple roots", () => {
  const engine = createLayoutEngine();
  const graph = buildGraph(
    [
      { id: 1, name: "Root A" },
      { id: 2, name: "Root B" },
      { id: 3, name: "Root C" },
    ],
    [1, 2, 3],
  );
  engine.setGraph(graph);
  const layout = engine.computeLayout();

  assertEquals(layout.nodes.size, 3);

  const rootA = layout.nodes.get(1)!;
  const rootB = layout.nodes.get(2)!;
  const rootC = layout.nodes.get(3)!;

  // All at depth 0
  assertEquals(rootA.x, 0);
  assertEquals(rootB.x, 0);
  assertEquals(rootC.x, 0);

  // Stacked vertically with spacing
  assert(rootB.y > rootA.y);
  assert(rootC.y > rootB.y);
});

/** Back-edge (subtask points to shallower depth) is excluded from layout walk. */
Deno.test("LayoutEngine - back-edge handling", () => {
  const engine = createLayoutEngine();
  // Node 2 lists node 1 as subtask (back-edge), but layout should still work
  const graph = buildGraph(
    [
      { id: 1, name: "Root", subtask_ids: [2], collapsed: false },
      { id: 2, name: "Child", subtask_ids: [1], collapsed: false },
    ],
    [1],
  );
  engine.setGraph(graph);
  const layout = engine.computeLayout();

  assertEquals(layout.nodes.size, 2);
  const root = layout.nodes.get(1)!;
  const child = layout.nodes.get(2)!;
  assertEquals(root.x, 0);
  assertEquals(child.x, 280);
});

/** Collapsed nodes hide children from layout. */
Deno.test("LayoutEngine - collapsed hides children", () => {
  const engine = createLayoutEngine();
  const graph = buildGraph(
    [
      { id: 1, name: "Root", subtask_ids: [2, 3], collapsed: true },
      { id: 2, name: "Child A" },
      { id: 3, name: "Child B" },
    ],
    [1],
  );
  engine.setGraph(graph);
  const layout = engine.computeLayout();

  // Only root is laid out; children are hidden
  assertEquals(layout.nodes.size, 1);
  assert(layout.nodes.has(1));
});

/** Undefined collapsed (default) hides children. */
Deno.test("LayoutEngine - undefined collapsed defaults to hidden", () => {
  const engine = createLayoutEngine();
  const graph = buildGraph(
    [
      { id: 1, name: "Root", subtask_ids: [2] },
      { id: 2, name: "Child" },
    ],
    [1],
  );
  engine.setGraph(graph);
  const layout = engine.computeLayout();

  assertEquals(layout.nodes.size, 1);
});

/** getLayoutBounds returns correct bounding rectangle. */
Deno.test("getLayoutBounds - basic", () => {
  const engine = createLayoutEngine();
  const graph = buildGraph(
    [
      { id: 1, name: "Root", subtask_ids: [2], collapsed: false },
      { id: 2, name: "Child" },
    ],
    [1],
  );
  engine.setGraph(graph);
  const layout = engine.computeLayout();
  const bounds = getLayoutBounds(layout);

  assert(bounds.width > 0);
  assert(bounds.height > 0);
  assert(bounds.minX <= bounds.maxX);
  assert(bounds.minY <= bounds.maxY);
});

/** getLayoutBounds handles empty layout. */
Deno.test("getLayoutBounds - empty", () => {
  const empty = { nodes: new Map(), edges: [] };
  const bounds = getLayoutBounds(empty);

  assertEquals(bounds.width, 0);
  assertEquals(bounds.height, 0);
  assertEquals(bounds.minX, 0);
  assertEquals(bounds.minY, 0);
});

/** Edges are collected from expanded nodes' subtask_ids. */
Deno.test("LayoutEngine - edge collection", () => {
  const engine = createLayoutEngine();
  const graph = buildGraph(
    [
      { id: 1, name: "Root", subtask_ids: [2, 3], collapsed: false },
      { id: 2, name: "Child A" },
      { id: 3, name: "Child B" },
    ],
    [1],
  );
  engine.setGraph(graph);
  const layout = engine.computeLayout();

  assertEquals(layout.edges.length, 2);
  assert(layout.edges.some((e) => e.from === 1 && e.to === 2));
  assert(layout.edges.some((e) => e.from === 1 && e.to === 3));
});

/** Node heights account for details and deadline fields. */
Deno.test("LayoutEngine - variable node height", () => {
  const engine = createLayoutEngine();
  const graph = buildGraph(
    [
      { id: 1, name: "Simple" },
      {
        id: 2,
        name: "Detailed",
        details: "Has details",
        deadline: "2025-01-01",
      },
    ],
    [1, 2],
  );
  engine.setGraph(graph);
  const layout = engine.computeLayout();

  const simple = layout.nodes.get(1)!;
  const detailed = layout.nodes.get(2)!;

  // Detailed node is taller due to details + deadline fields
  assert(detailed.height > simple.height);
});

/** setConfig updates the layout configuration. */
Deno.test("LayoutEngine - setConfig", () => {
  const engine = new LayoutEngine();
  engine.setConfig({ horizontalSpacing: 400 });

  const graph = buildGraph(
    [
      { id: 1, name: "Root", subtask_ids: [2], collapsed: false },
      { id: 2, name: "Child" },
    ],
    [1],
  );
  engine.setGraph(graph);
  const layout = engine.computeLayout();

  const child = layout.nodes.get(2)!;
  assertEquals(child.x, 400);
});

/** clearCache resets internal state. */
Deno.test("LayoutEngine - clearCache", () => {
  const engine = createLayoutEngine();
  const graph = buildGraph([{ id: 1, name: "Root" }], [1]);
  engine.setGraph(graph);
  engine.computeLayout();
  engine.clearCache();
  // Recompute after clear still works
  const layout = engine.computeLayout();
  assertEquals(layout.nodes.size, 1);
});

/** Deep nested tree layout. */
Deno.test("LayoutEngine - deep nesting", () => {
  const engine = createLayoutEngine();
  const graph = buildGraph(
    [
      { id: 1, name: "Root", subtask_ids: [2], collapsed: false },
      { id: 2, name: "L1", subtask_ids: [3], collapsed: false },
      { id: 3, name: "L2", subtask_ids: [4], collapsed: false },
      { id: 4, name: "L3" },
    ],
    [1],
  );
  engine.setGraph(graph);
  const layout = engine.computeLayout();

  assertEquals(layout.nodes.size, 4);

  const l1 = layout.nodes.get(2)!;
  const l2 = layout.nodes.get(3)!;
  const l3 = layout.nodes.get(4)!;

  // Verify depth progression
  assertEquals(l1.x, 280);
  assertEquals(l2.x, 280 * 2);
  assertEquals(l3.x, 280 * 3);
});

/** Shifts propagate to grandchildren when a sibling is shifted. */
Deno.test("LayoutEngine - shift propagation to grandchildren", () => {
  const engine = createLayoutEngine();
  // Root -> A, B, C where B has children B1, B2
  // When B is shifted to avoid A, B1 and B2 must also shift.
  const graph = buildGraph(
    [
      { id: 1, name: "Root", subtask_ids: [2, 3, 4], collapsed: false },
      { id: 2, name: "A" },
      { id: 3, name: "B", subtask_ids: [5, 6], collapsed: false },
      { id: 4, name: "C" },
      { id: 5, name: "B1" },
      { id: 6, name: "B2" },
    ],
    [1],
  );
  engine.setGraph(graph);
  const layout = engine.computeLayout();

  assertEquals(layout.nodes.size, 6);

  const b = layout.nodes.get(3)!;
  const b1 = layout.nodes.get(5)!;
  const b2 = layout.nodes.get(6)!;

  // B1 and B2 must be below A
  const a = layout.nodes.get(2)!;
  assert(b1.y >= a.y + a.height, "B1 should be below A");
  assert(b2.y >= a.y + a.height, "B2 should be below A");

  // B centered on B1 and B2
  const b1Center = b1.y + b1.height / 2;
  const b2Center = b2.y + b2.height / 2;
  const expectedB = (b1Center + b2Center) / 2;
  assertEquals(b.y, expectedB);

  // All grandchildren at depth 2
  assertEquals(b1.x, 280 * 2);
  assertEquals(b2.x, 280 * 2);
});

/** Exhaustive overlap check: no two nodes at the same depth should overlap on Y. */
Deno.test("LayoutEngine - no same-depth overlaps (many siblings)", () => {
  const engine = createLayoutEngine();
  // Root -> P1(leaf), P2(has Q1..Q5), P3(has R1,R2)
  // This creates many depth=2 nodes from multiple parents
  const graph = buildGraph(
    [
      { id: 1, name: "Root", subtask_ids: [2, 3, 4], collapsed: false },
      { id: 2, name: "P1" }, // leaf at depth=1
      {
        id: 3,
        name: "P2",
        subtask_ids: [5, 6, 7, 8, 9],
        collapsed: false,
      }, // 5 children at depth=2
      { id: 4, name: "P3", subtask_ids: [10, 11], collapsed: false }, // 2 children at depth=2
      { id: 5, name: "Q1" },
      { id: 6, name: "Q2" },
      { id: 7, name: "Q3" },
      { id: 8, name: "Q4" },
      { id: 9, name: "Q5" },
      { id: 10, name: "R1" },
      { id: 11, name: "R2" },
    ],
    [1],
  );
  engine.setGraph(graph);
  const layout = engine.computeLayout();

  // Group nodes by depth (x / horizontalSpacing)
  const byDepth = new Map<number, typeof layout.nodes>();
  for (const node of layout.nodes.values()) {
    const depth = Math.round(node.x / 280);
    if (!byDepth.has(depth)) byDepth.set(depth, new Map());
    byDepth.get(depth)!.set(node.id, node);
  }

  // Check all pairs at each depth for Y-axis overlaps
  for (const [depth, nodes] of byDepth) {
    const arr = Array.from(nodes.values()).sort((a, b) => a.y - b.y);
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i];
      const b = arr[i + 1];
      const gap = b.y - (a.y + a.height);
      assert(
        gap >= 0,
        `Depth ${depth}: node ${a.id} (y=${a.y}, h=${a.height}) overlaps node ${b.id} (y=${b.y}), gap=${gap}`,
      );
    }
  }
});

/** First child of many: when a parent has many children, the first should not overlap with previous siblings' subtrees. */
Deno.test("LayoutEngine - first child of many no overlap", () => {
  const engine = createLayoutEngine();
  // Root -> A(leaf), B(has C1..C6)
  // C1 is the "first child of many" — must not overlap with A
  const graph = buildGraph(
    [
      { id: 1, name: "Root", subtask_ids: [2, 3], collapsed: false },
      { id: 2, name: "A" }, // leaf at depth=1
      {
        id: 3,
        name: "B",
        subtask_ids: [4, 5, 6, 7, 8, 9],
        collapsed: false,
      },
      { id: 4, name: "C1" },
      { id: 5, name: "C2" },
      { id: 6, name: "C3" },
      { id: 7, name: "C4" },
      { id: 8, name: "C5" },
      { id: 9, name: "C6" },
    ],
    [1],
  );
  engine.setGraph(graph);
  const layout = engine.computeLayout();

  const a = layout.nodes.get(2)!;
  const c1 = layout.nodes.get(4)!;

  // C1 must be below A with at least verticalSpacing gap
  assert(
    c1.y >= a.y + a.height + 32,
    `C1 (y=${c1.y}) should be below A (ends at ${a.y + a.height}), got gap=${
      c1.y - (a.y + a.height)
    }`,
  );

  // All C-nodes must not overlap with each other
  const cNodes = [4, 5, 6, 7, 8, 9].map((id) => layout.nodes.get(id)!);
  cNodes.sort((a, b) => a.y - b.y);
  for (let i = 0; i < cNodes.length - 1; i++) {
    const gap = cNodes[i + 1].y - (cNodes[i].y + cNodes[i].height);
    assert(
      gap >= 0,
      `C-node ${cNodes[i].id} overlaps C-node ${cNodes[i + 1].id}, gap=${gap}`,
    );
  }
});

/** Parent bounding box must include the parent's own height, not just children. */
Deno.test("LayoutEngine - parent bounds include self height", () => {
  const engine = createLayoutEngine();
  // Root -> A(leaf), B(has C1)
  // B is tall (has details+deadline) but its only child C1 is short.
  // Without including B's own height in its bounding box, sibling spacing
  // would underestimate B's extent and let the next sibling overlap with B.
  const graph = buildGraph(
    [
      {
        id: 1,
        name: "Root",
        subtask_ids: [2, 3],
        collapsed: false,
      },
      { id: 2, name: "A" }, // leaf at depth=1
      {
        id: 3,
        name: "B",
        details: "Tall node with lots of content",
        deadline: "2026-05-01",
        subtask_ids: [4],
        collapsed: false,
      }, // tall at depth=1
      { id: 4, name: "C1" }, // short child at depth=2
    ],
    [1],
  );
  engine.setGraph(graph);
  const layout = engine.computeLayout();

  const a = layout.nodes.get(2)!;
  const b = layout.nodes.get(3)!;
  const c1 = layout.nodes.get(4)!;

  // B must be below A with gap (B is tall, so its bounding box should reflect that)
  assert(
    b.y >= a.y + a.height + 32,
    `B (y=${b.y}) should be below A (ends at ${a.y + a.height}), got gap=${
      b.y - (a.y + a.height)
    }`,
  );

  // C1 must not overlap with A either
  assert(
    c1.y >= a.y + a.height,
    `C1 (y=${c1.y}) should be below A (ends at ${a.y + a.height})`,
  );
});
