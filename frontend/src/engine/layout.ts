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
 * The algorithm uses two walks:
 *   Pass 1 (bottom-up):  compute prelim positions, shift subtrees to avoid overlap
 *   Pass 2 (top-down):   collect final positions
 *
 * This guarantees zero collisions with tight, deterministic spacing —
 * no magic multipliers needed.
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

/** Per-node state for the Reingold-Tilford algorithm */
interface RTState {
  prelim: number; // Absolute tentative Y position (shifted during first walk)
  depth: number; // Depth from root (0 = root)
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class LayoutEngine {
  private config: LayoutConfig;
  private nodeMap: Map<number, GraphNode> = new Map();
  private rootIds: number[] = [];

  // Reingold-Tilford state (reset each computeLayout call)
  private rtState = new Map<number, RTState>();

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

  // -----------------------------------------------------------------------
  // Public entry point
  // -----------------------------------------------------------------------

  computeLayout(): LayoutResult {
    // Clear per-layout state
    this.rtState.clear();

    // Initialize and walk each root
    for (let i = 0; i < this.rootIds.length; i++) {
      const rootId = this.rootIds[i];
      const root = this.nodeMap.get(rootId);
      if (!root) continue;

      this.rtState.set(rootId, { prelim: 0, depth: 0 });

      // First walk (bottom-up): compute prelim positions and depth
      this.firstWalk(rootId, 0);

      // Apply spacing between consecutive roots
      if (i > 0) {
        const prevRootId = this.rootIds[i - 1];
        const prevRoot = this.nodeMap.get(prevRootId);
        if (prevRoot) {
          const prevBottom = this.getSubtreeBottom(prevRootId);
          const gap = this.estimateNodeHeight(prevRoot) + MIN_V_GAP;
          const currTop = this.rtState.get(rootId)!.prelim;
          const needed = prevBottom + gap;

          if (currTop < needed) {
            this.shiftSubtree(rootId, needed - currTop);
          }
        }
      }

      // Re-center root on its children after all shifting
      this.reCenterNode(rootId);
    }

    // Re-center all parents on their final child positions
    // (shifts to descendants don't auto-update the parent, so we fix it now)
    this.reCenterAll(this.rootIds);

    // Collect placed nodes (prelim and depth are final after first walk)
    const nodes = new Map<number, LayoutNode>();
    for (const [nodeId, rt] of this.rtState) {
      const node = this.nodeMap.get(nodeId);
      if (!node) continue;

      const selfW = this.estimateNodeWidth(node);
      const selfH = this.estimateNodeHeight(node);

      nodes.set(nodeId, {
        id: nodeId,
        x: rt.depth * this.config.horizontalSpacing,
        y: rt.prelim,
        width: selfW,
        height: selfH,
      });
    }

    // Collect edges (parent → child for all visible relationships)
    const edges: Array<{ from: number; to: number }> = [];
    for (const [nodeId] of this.rtState) {
      const node = this.nodeMap.get(nodeId);
      if (!node) continue;
      for (const child of this.getChildren(node)) {
        if (this.rtState.has(child.id)) {
          edges.push({ from: nodeId, to: child.id });
        }
      }
    }

    return { nodes, edges };
  }

  // -----------------------------------------------------------------------
  // Pass 1 — bottom-up prelim positions (Reingold-Tilford firstWalk)
  // -----------------------------------------------------------------------

  /**
   * Bottom-up walk that computes preliminary Y positions and depth.
   *
   * For each node:
   * 1. Recursively first-walk all children (depth + 1)
   * 2. Ensure siblings don't overlap (shift subtrees as needed)
   * 3. Center the node vertically on its children
   */
  private firstWalk(nodeId: number, depth: number): void {
    const rt = this.rtState.get(nodeId);
    if (!rt) return;

    // Store depth in RT state
    rt.depth = depth;

    const node = this.nodeMap.get(nodeId);
    if (!node) return;

    const children = this.getChildren(node);

    if (children.length === 0) {
      // Leaf: prelim stays at its initial value (0 for roots, or inherited)
      return;
    }

    // First walk all children recursively
    for (let i = 0; i < children.length; i++) {
      const child = children[i];

      // Initialize child's RT state with depth + 1
      if (!this.rtState.has(child.id)) {
        this.rtState.set(child.id, { prelim: 0, depth: depth + 1 });
      }

      this.firstWalk(child.id, depth + 1);

      if (i > 0) {
        // Ensure proper spacing from previous sibling's subtree
        const prevChild = children[i - 1];
        const prevBottom = this.getSubtreeBottom(prevChild.id);

        // Use subtree top, not just the child's own Y,
        // because descendants can extend above their parent
        const currTop = this.getSubtreeTop(child.id);
        const needed = prevBottom + MIN_V_GAP;

        if (currTop < needed) {
          this.shiftSubtree(child.id, needed - currTop);
        }
      }
    }

    // Center parent on children
    const leftChild = children[0];
    const rightChild = children[children.length - 1];
    const leftH = this.estimateNodeHeight(leftChild);
    const rightH = this.estimateNodeHeight(rightChild);

    const leftCenter = this.getAbsoluteY(leftChild.id) + leftH / 2;
    const rightCenter = this.getAbsoluteY(rightChild.id) + rightH / 2;

    rt.prelim = (leftCenter + rightCenter) / 2;
  }

  // -----------------------------------------------------------------------
  // Reingold-Tilford helpers
  // -----------------------------------------------------------------------

  /** Shift a node and all its descendants by the given distance */
  private shiftSubtree(nodeId: number, distance: number): void {
    const rt = this.rtState.get(nodeId);
    if (!rt) return;

    rt.prelim += distance;

    const node = this.nodeMap.get(nodeId);
    if (!node) return;

    for (const child of this.getChildren(node)) {
      if (this.rtState.has(child.id)) {
        this.shiftSubtree(child.id, distance);
      }
    }
  }

  /** Get the absolute Y position of a node */
  private getAbsoluteY(nodeId: number): number {
    const rt = this.rtState.get(nodeId);
    if (!rt) return 0;
    return rt.prelim;
  }

  /** Get the bottom edge of a placed subtree */
  private getSubtreeBottom(rootId: number): number {
    let bottom = -Infinity;
    const queue = [rootId];

    while (queue.length > 0) {
      const id = queue.shift()!;
      const rt = this.rtState.get(id);
      const node = this.nodeMap.get(id);
      if (!rt || !node) continue;

      const absY = rt.prelim;
      const h = this.estimateNodeHeight(node);
      bottom = Math.max(bottom, absY + h);

      for (const child of this.getChildren(node)) {
        if (this.rtState.has(child.id)) queue.push(child.id);
      }
    }

    return bottom;
  }

  /** Get the top edge of a placed subtree */
  private getSubtreeTop(rootId: number): number {
    let top = Infinity;
    const queue = [rootId];

    while (queue.length > 0) {
      const id = queue.shift()!;
      const rt = this.rtState.get(id);
      const node = this.nodeMap.get(id);
      if (!rt || !node) continue;

      top = Math.min(top, rt.prelim);

      for (const child of this.getChildren(node)) {
        if (this.rtState.has(child.id)) queue.push(child.id);
      }
    }

    return top;
  }

  /**
   * Recursively re-center a node on its children's final positions.
   *
   * This is needed because shiftSubtree moves descendants but leaves
   * the parent's prelim stale. We walk bottom-up so children are
   * finalized before their parent is re-centered.
   */
  private reCenterAll(rootIds: number[]): void {
    for (const rootId of rootIds) {
      this.reCenterNode(rootId);
    }
  }

  private reCenterNode(nodeId: number): void {
    const node = this.nodeMap.get(nodeId);
    if (!node) return;

    // Recurse into children first (bottom-up)
    for (const child of this.getChildren(node)) {
      if (this.rtState.has(child.id)) {
        this.reCenterNode(child.id);
      }
    }

    // Now center this node on its children
    const children = this.getChildren(node).filter((c) =>
      this.rtState.has(c.id),
    );

    if (children.length === 0) return;

    const first = children[0];
    const last = children[children.length - 1];
    const firstH = this.estimateNodeHeight(first);
    const lastH = this.estimateNodeHeight(last);
    const firstCenter = this.getAbsoluteY(first.id) + firstH / 2;
    const lastCenter = this.getAbsoluteY(last.id) + lastH / 2;

    const rt = this.rtState.get(nodeId);
    if (rt) {
      rt.prelim = (firstCenter + lastCenter) / 2;
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

  clearCache(): void {
    this.rtState.clear();
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

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
