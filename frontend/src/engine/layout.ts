/**
 * Graph Layout Engine — two-pass hierarchical tree layout.
 *
 * Pass 1 (bottom-up): compute subtree height for every node.
 * Pass 2 (top-down): place nodes using dynamic vertical spacing per level.
 *
 * Horizontal spacing is static so bezier curves have predictable room.
 * Vertical spacing scales with the tallest sibling at each depth level,
 * preventing both collisions and wasted gaps.
 */

import type { Graph, GraphNode, LayoutConfig } from "../types/graph";
import { DEFAULT_LAYOUT } from "../types/graph";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_NODE_HEIGHT = 40;
const FIELD_HEIGHT_DETAILS = 28;
const FIELD_HEIGHT_DEADLINE = 24;

/** Minimum vertical gap between siblings (pixels) */
const MIN_V_GAP = 16;

/** Multiplier for dynamic spacing — fraction of max subtree height at a level */
const V_SPACING_FACTOR = 0.15;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class LayoutEngine {
  private config: LayoutConfig;
  private nodeMap: Map<number, GraphNode> = new Map();
  private rootIds: number[] = [];

  // Per-layout caches (invalidated on setGraph / setConfig)
  private subtreeHeights: Map<number, number> | null = null;

  constructor(config: LayoutConfig = DEFAULT_LAYOUT) {
    this.config = config;
  }

  setGraph(graph: Graph): void {
    this.nodeMap.clear();
    for (const node of graph.nodes) {
      this.nodeMap.set(node.id, node);
    }
    this.rootIds = graph.root_ids || [];
    this.subtreeHeights = null;
  }

  setConfig(config: Partial<LayoutConfig>): void {
    this.config = { ...this.config, ...config };
    this.subtreeHeights = null;
  }

  // -----------------------------------------------------------------------
  // Public entry point
  // -----------------------------------------------------------------------

  computeLayout(): LayoutResult {
    const heights = this.computeSubtreeHeights();
    const nodes = new Map<number, LayoutNode>();
    const edges: Array<{ from: number; to: number }> = [];

    let rootY = 0;
    for (const rootId of this.rootIds) {
      const root = this.nodeMap.get(rootId);
      if (!root) continue;

      this.placeSubtree(rootId, 0, rootY, heights, nodes, edges);

      // Next root starts below this one's full subtree extent
      const placedRoot = nodes.get(rootId);
      const subtreeMaxY = this.findSubtreeMaxY(rootId, nodes);
      rootY = subtreeMaxY + this.config.verticalSpacing;
    }

    return { nodes, edges };
  }

  // -----------------------------------------------------------------------
  // Pass 1 — bottom-up subtree heights
  // -----------------------------------------------------------------------

  /**
   * Returns a map of nodeId → total rendered height of that node's visible
   * subtree (including all descendants and the gaps between them).
   */
  private computeSubtreeHeights(): Map<number, number> {
    if (this.subtreeHeights) return this.subtreeHeights;

    const cache = new Map<number, number>();
    const visited = new Set<number>();

    const visit = (id: number): number => {
      if (cache.has(id)) return cache.get(id)!;
      if (visited.has(id)) return 0; // guard against cycles
      visited.add(id);

      const node = this.nodeMap.get(id);
      if (!node) return 0;

      const selfH = this.estimateNodeHeight(node);
      const children = this.getChildren(node);

      if (children.length === 0) {
        cache.set(id, selfH);
        return selfH;
      }

      // Sum of all child subtree heights + gaps between them
      let total = selfH;
      for (const ch of children) {
        total += visit(ch.id);
      }
      // Add gap after each child except the last
      total += Math.max(0, children.length - 1) * this.config.verticalSpacing;

      cache.set(id, total);
      return total;
    };

    for (const rid of this.rootIds) visit(rid);
    this.subtreeHeights = cache;
    return cache;
  }

  // -----------------------------------------------------------------------
  // Pass 2 — top-down placement with dynamic vertical spacing
  // -----------------------------------------------------------------------

  /**
   * Place a subtree rooted at `nodeId` at `(x, y)`.
   *
   * Children are placed to the right (static horizontalSpacing).
   * Vertical positions use dynamic spacing: we first collect all children's
   * subtree heights, then distribute them evenly around the parent using
   * a gap derived from the maximum child height.
   */
  private placeSubtree(
    nodeId: number,
    x: number,
    y: number,
    heights: Map<number, number>,
    nodes: Map<number, LayoutNode>,
    edges: Array<{ from: number; to: number }>,
  ): void {
    const node = this.nodeMap.get(nodeId);
    if (!node) return;

    const selfH = this.estimateNodeHeight(node);
    const selfW = this.estimateNodeWidth(node);

    nodes.set(nodeId, { id: nodeId, x, y, width: selfW, height: selfH });

    const children = this.getChildren(node);
    if (children.length === 0) return;

    // Collect child subtree heights
    const childHeights: number[] = [];
    for (const ch of children) {
      childHeights.push(heights.get(ch.id) ?? selfH);
    }

    // Dynamic vertical gap — scales with the tallest sibling at this level
    const maxChildHeight = Math.max(...childHeights);
    const vGap = Math.max(MIN_V_GAP, maxChildHeight * V_SPACING_FACTOR);

    // Total band occupied by children + gaps
    let totalBand = childHeights.reduce((a, b) => a + b, 0);
    totalBand += Math.max(0, childHeights.length - 1) * vGap;

    // Start Y so the child band is centered on the parent's midpoint
    const childStartY = y + selfH / 2 - totalBand / 2;

    let curY = childStartY;
    for (let i = 0; i < children.length; i++) {
      const ch = children[i];
      edges.push({ from: nodeId, to: ch.id });
      this.placeSubtree(
        ch.id,
        x + this.config.horizontalSpacing,
        curY,
        heights,
        nodes,
        edges,
      );
      curY += childHeights[i] + vGap;
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private getChildren(node: GraphNode): GraphNode[] {
    // If collapsed (default true), hide children from layout
    if (node.collapsed === true || node.collapsed === undefined) return [];
    if (!node.subtask_ids || node.subtask_ids.length === 0) return [];
    return node.subtask_ids
      .map((id) => this.nodeMap.get(id))
      .filter((n): n is GraphNode => n !== undefined);
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

  /** Walk placed nodes to find the maximum Y+height in a subtree */
  private findSubtreeMaxY(
    rootId: number,
    nodes: Map<number, LayoutNode>,
  ): number {
    let maxY = -Infinity;
    const queue: number[] = [rootId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const ln = nodes.get(id);
      if (ln) maxY = Math.max(maxY, ln.y + ln.height);
      const gn = this.nodeMap.get(id);
      if (gn) {
        for (const cid of gn.subtask_ids || []) {
          if (nodes.has(cid)) queue.push(cid);
        }
      }
    }
    return maxY;
  }

  clearCache(): void {
    this.subtreeHeights = null;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function createLayoutEngine(
  config?: Partial<LayoutConfig>,
): LayoutEngine {
  return new LayoutEngine(config ?? DEFAULT_LAYOUT);
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
