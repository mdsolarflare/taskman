/**
 * Graph Layout Engine — Reingold-Tilford hierarchical tree layout.
 *
 * Reingold, E. M.; Tilford, J. S. (1991), "Tidier Drawings of Trees",
 * Software: Practice and Experience, 21(2): 95-113.
 *
 * Adapted for:
 * - Left-to-right trees (X = depth * horizontalSpacing, Y = RT position)
 * - Variable node heights (spacing between siblings accounts for actual height)
 * - Multiple roots (each root processed as a separate tree)
 *
 * Back-edge handling:
 *   DAGs may contain edges that point to a shallower depth (cycles from
 *   the layout's perspective). We filter these out in `getLayoutChildren`
 *   so the layout walks a clean tree with no cycles.
 *
 * The algorithm uses a single bottom-up walk:
 *   firstWalk: walk children → shift siblings apart → center parent
 *
 * This guarantees zero collisions with tight, deterministic spacing —
 * no magic multipliers needed.
 */

import type { Graph, GraphNode, LayoutConfig } from "../types/graph";
import { DEFAULT_LAYOUT } from "../types/graph";

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const BASE_NODE_HEIGHT = 40;
const FIELD_HEIGHT_DETAILS = 28;
const FIELD_HEIGHT_DEADLINE = 24;

/** Minimum vertical gap between siblings (pixels) */
const MIN_V_GAP = 16;

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

interface LayoutNode {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LayoutResult {
  nodes: Map<number, LayoutNode>;
  edges: Array<{ from: number; to: number }>;
}

/** Per-node state for the Reingold-Tilford algorithm */
interface RT {
  prelim: number; // Final Y position (computed during firstWalk)
  depth: number; // Depth from root (0 = root)
}

// --------------------------------------------------------------------------
// Engine
// --------------------------------------------------------------------------

export class LayoutEngine {
  private config: LayoutConfig;
  private nodeMap: Map<number, GraphNode> = new Map();
  private rootIds: number[] = [];

  // Reingold-Tilford state (reset each computeLayout call)
  private rt = new Map<number, RT>();

  constructor(config: LayoutConfig = DEFAULT_LAYOUT) {
    this.config = config;
  }

  setGraph(graph: Graph): void {
    this.nodeMap.clear();
    for (const node of graph.nodes) {
      this.nodeMap.set(node.id, node);
    }
    this.rootIds = graph.root_ids || [];
  }

  setConfig(config: Partial<LayoutConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ------------------------------------------------------------------
  // Public entry point
  // ------------------------------------------------------------------

  computeLayout(): LayoutResult {
    this.rt.clear();

    // Initialize and walk each root
    for (let i = 0; i < this.rootIds.length; i++) {
      const rootId = this.rootIds[i];
      const root = this.nodeMap.get(rootId);
      if (!root) continue;

      this.rt.set(rootId, { prelim: 0, depth: 0 });

      this.firstWalk(rootId, 0);

      // Apply spacing between consecutive roots
      if (i > 0) {
        const prevRootId = this.rootIds[i - 1];
        const prevRoot = this.nodeMap.get(prevRootId);
        if (prevRoot) {
          const prevBottom = this.getSubtreeBottom(prevRootId);
          const gap = this.estimateNodeHeight(prevRoot) + MIN_V_GAP;
          const currTop = this.getSubtreeTop(rootId);
          const needed = prevBottom + gap;

          if (currTop < needed) {
            this.shiftSubtree(rootId, needed - currTop);
            // Root was shifted, re-center it on its children
            this.recenterNode(rootId);
          }
        }
      }
    }

    // Collect placed nodes
    const nodes = new Map<number, LayoutNode>();
    for (const [nodeId, r] of this.rt) {
      const node = this.nodeMap.get(nodeId);
      if (!node) continue;

      const selfW = this.estimateNodeWidth(node);
      const selfH = this.estimateNodeHeight(node);

      nodes.set(nodeId, {
        id: nodeId,
        x: r.depth * this.config.horizontalSpacing,
        y: r.prelim,
        width: selfW,
        height: selfH,
      });
    }

    // Collect edges from raw subtask_ids (including back-edges).
    // Back-edges affect rendering but not layout positioning.
    const edges: Array<{ from: number; to: number }> = [];
    for (const [nodeId] of this.rt) {
      const node = this.nodeMap.get(nodeId);
      if (!node) continue;
      if (!node.subtask_ids || node.subtask_ids.length === 0) continue;
      if (node.collapsed === true || node.collapsed === undefined) continue;
      for (const childId of node.subtask_ids) {
        if (this.rt.has(childId)) {
          edges.push({ from: nodeId, to: childId });
        }
      }
    }

    return { nodes, edges };
  }

  // ------------------------------------------------------------------
  // Reingold-Tilford firstWalk (bottom-up)
  // ------------------------------------------------------------------

  /**
   * Bottom-up walk that computes final Y positions.
   *
   * Order matters:
   *   1. Recursively walk all children
   *   2. Shift siblings apart to avoid overlap
   *   3. Center parent on its children (using final shifted positions)
   */
  private firstWalk(nodeId: number, depth: number): void {
    const node = this.nodeMap.get(nodeId);
    if (!node) return;

    const children = this.getLayoutChildren(nodeId, node.collapsed);

    if (children.length === 0) {
      // Leaf: prelim stays 0
      return;
    }

    // 1. Recursively walk all children first
    for (const child of children) {
      if (!this.rt.has(child.id)) {
        this.rt.set(child.id, { prelim: 0, depth: depth + 1 });
      }
      this.firstWalk(child.id, depth + 1);
    }

    // 2. Shift siblings apart to avoid overlap
    let prevChild = children[0];
    for (let i = 1; i < children.length; i++) {
      const child = children[i];
      this.ensureSiblingSpacing(prevChild, child);
      prevChild = child;
    }

    // 3. Center parent on its children (after shifting — positions are final)
    const first = children[0];
    const last = children[children.length - 1];
    const firstCenter =
      this.rt.get(first.id)!.prelim + this.estimateNodeHeight(first) / 2;
    const lastCenter =
      this.rt.get(last.id)!.prelim + this.estimateNodeHeight(last) / 2;

    this.rt.get(nodeId)!.prelim = (firstCenter + lastCenter) / 2;
  }

  /** Ensure `later` sibling is below `earlier` sibling by at least MIN_V_GAP. */
  private ensureSiblingSpacing(earlier: GraphNode, later: GraphNode): void {
    const prevBottom = this.getSubtreeBottom(earlier.id);
    const currTop = this.getSubtreeTop(later.id);
    const needed = prevBottom + MIN_V_GAP;

    if (currTop < needed) {
      this.shiftSubtree(later.id, needed - currTop);
    }
  }

  // ------------------------------------------------------------------
  // RT helpers
  // ------------------------------------------------------------------

  /** Shift a node and all its layout-descendants by the given distance. */
  private shiftSubtree(nodeId: number, distance: number): void {
    const r = this.rt.get(nodeId);
    if (!r) return;

    r.prelim += distance;

    const node = this.nodeMap.get(nodeId);
    if (!node) return;

    for (const child of this.getLayoutChildren(nodeId, node.collapsed)) {
      if (this.rt.has(child.id)) {
        this.shiftSubtree(child.id, distance);
      }
    }
  }

  /** Center a node on its children's current positions (used after root shifts). */
  private recenterNode(nodeId: number): void {
    const node = this.nodeMap.get(nodeId);
    if (!node) return;

    const children = this.getLayoutChildren(nodeId, node.collapsed).filter(
      (c) => this.rt.has(c.id),
    );

    if (children.length === 0) return;

    const first = children[0];
    const last = children[children.length - 1];
    const firstCenter =
      this.rt.get(first.id)!.prelim + this.estimateNodeHeight(first) / 2;
    const lastCenter =
      this.rt.get(last.id)!.prelim + this.estimateNodeHeight(last) / 2;

    this.rt.get(nodeId)!.prelim = (firstCenter + lastCenter) / 2;
  }

  /** Get the bottom edge (max prelim + height) of a placed subtree. */
  private getSubtreeBottom(rootId: number): number {
    let bottom = -Infinity;
    const queue: number[] = [rootId];

    while (queue.length > 0) {
      const id = queue.shift()!;
      const r = this.rt.get(id);
      const node = this.nodeMap.get(id);
      if (!r || !node) continue;

      bottom = Math.max(bottom, r.prelim + this.estimateNodeHeight(node));

      for (const child of this.getLayoutChildren(id, node.collapsed)) {
        if (this.rt.has(child.id)) queue.push(child.id);
      }
    }

    return bottom;
  }

  /** Get the top edge (min prelim) of a placed subtree. */
  private getSubtreeTop(rootId: number): number {
    let top = Infinity;
    const queue: number[] = [rootId];

    while (queue.length > 0) {
      const id = queue.shift()!;
      const r = this.rt.get(id);
      if (!r) continue;

      top = Math.min(top, r.prelim);

      const node = this.nodeMap.get(id);
      if (!node) continue;
      for (const child of this.getLayoutChildren(id, node.collapsed)) {
        if (this.rt.has(child.id)) queue.push(child.id);
      }
    }

    return top;
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * Get the layout children of a node, filtering out back-edges.
   *
   * A back-edge is a subtask whose depth is <= the parent's depth.
   * This eliminates cycles so the layout walks a clean tree.
   */
  private getLayoutChildren(
    nodeId: number,
    collapsed: boolean | undefined,
  ): GraphNode[] {
    if (collapsed === true || collapsed === undefined) return [];
    const node = this.nodeMap.get(nodeId);
    if (!node) return [];
    if (!node.subtask_ids || node.subtask_ids.length === 0) return [];

    const parentDepth = this.rt.get(nodeId)?.depth ?? 0;

    return node.subtask_ids
      .map((id) => this.nodeMap.get(id))
      .filter((n): n is GraphNode => n !== undefined)
      .filter((child) => {
        // If child hasn't been visited yet, it's a forward edge
        if (!this.rt.has(child.id)) return true;
        // If child has a deeper depth, it's a forward edge
        const childDepth = this.rt.get(child.id)!.depth;
        return childDepth > parentDepth;
      });
  }

  private estimateNodeWidth(node: GraphNode): number {
    const nameW = node.name.length * 8;
    return Math.max(200, nameW + 32);
  }

  private estimateNodeHeight(node: GraphNode): number {
    let h = BASE_NODE_HEIGHT;
    if (node.details) h += FIELD_HEIGHT_DETAILS;
    if (node.deadline) h += FIELD_HEIGHT_DEADLINE;
    return h;
  }

  clearCache(): void {
    this.rt.clear();
  }
}

// --------------------------------------------------------------------------
// Utilities
// --------------------------------------------------------------------------

export function createLayoutEngine(
  config?: Partial<LayoutConfig>,
): LayoutEngine {
  return new LayoutEngine({ ...DEFAULT_LAYOUT, ...config });
}

export function getLayoutBounds(layout: LayoutResult): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
} {
  if (layout.nodes.size === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const n of layout.nodes.values()) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }

  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
