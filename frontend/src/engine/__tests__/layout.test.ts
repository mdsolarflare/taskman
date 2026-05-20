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
