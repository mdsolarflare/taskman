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
 * - Bounding-box spacing heuristic (not level-by-level contour scanning)
 *
 * Back-edge handling:
 *   DAGs may contain edges that point to a shallower depth (cycles from
 *   the layout's perspective). We filter these out in `getLayoutChildren`
 *   so the layout walks a clean tree with no cycles.
 *
 * The algorithm uses two passes:
 *   1. firstWalk (bottom-up): compute relative positions, accumulate sibling shifts
 *   2. applyShifts (top-down): propagate shifts and finalize absolute positions
 *
 * This guarantees zero collisions with tight, deterministic spacing —
 * no magic multipliers needed.
 */

import type { Graph, GraphNode, LayoutConfig } from "../types/graph.ts";
import { DEFAULT_LAYOUT } from "../types/graph.ts";

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const BASE_NODE_HEIGHT = 40;
const FIELD_HEIGHT_DETAILS = 28;
const FIELD_HEIGHT_DEADLINE = 24;

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
  prelim: number; // Relative Y position (computed during firstWalk, relative to parent)
  depth: number; // Depth from root (0 = root)
  minY: number; // Top edge of subtree (relative to parent frame)
  maxY: number; // Bottom edge of subtree (relative to parent frame)
  shift: number; // Accumulated shift from ancestor spacing constraints
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

      this.rt.set(rootId, { prelim: 0, depth: 0, minY: 0, maxY: 0, shift: 0 });

      this.firstWalk(rootId, 0, 0);

      // Apply spacing between consecutive roots
      if (i > 0) {
        const prevRootId = this.rootIds[i - 1];
        const prevRoot = this.nodeMap.get(prevRootId);
        if (prevRoot) {
          const prevRT = this.rt.get(prevRootId)!;
          // True bottom = prelim + shift + maxY (maxY is relative to node's origin)
          const prevBottom = prevRT.prelim + prevRT.shift + prevRT.maxY;
          const gap = this.estimateNodeHeight(prevRoot) +
            this.config.verticalSpacing;
          const currRT = this.rt.get(rootId)!;
          // True top = prelim + shift + minY
          const currTop = currRT.prelim + currRT.shift + currRT.minY;
          const needed = prevBottom + gap;

          if (currTop < needed) {
            // Accumulate shift on the root (applied during second pass)
            currRT.shift += needed - currTop;
          }
        }
      }
    }

    // Second pass: propagate accumulated shifts top-down and finalize positions (O(n))
    for (const rootId of this.rootIds) {
      this.applyShifts(rootId, 0);
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
      if (node.collapsed === true || node.collapsed === undefined) {
        continue;
      }
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
   * Bottom-up walk that computes relative Y positions.
   *
   * Order matters:
   *   1. Recursively walk all children
   *   2. Shift siblings apart to avoid overlap (accumulate shift only, no prelim mutation)
   *   3. Center parent on its children's true positions
   *   4. Cache subtree bounds relative to parent frame
   *
   * `ancestorShift` is the accumulated shift from all ancestors — used to compute
   * true (absolute) positions of children for spacing and centering.
   */
  private firstWalk(
    nodeId: number,
    depth: number,
    ancestorShift: number,
  ): void {
    const node = this.nodeMap.get(nodeId);
    if (!node) return;

    const children = this.getLayoutChildren(nodeId, node.collapsed);

    if (children.length === 0) {
      // Leaf: prelim stays 0, bounds are just the node itself
      const h = this.estimateNodeHeight(node);
      this.rt.get(nodeId)!.minY = 0;
      this.rt.get(nodeId)!.maxY = h;
      return;
    }

    // 1. Recursively walk all children first
    for (const child of children) {
      if (!this.rt.has(child.id)) {
        this.rt.set(child.id, {
          prelim: 0,
          depth: depth + 1,
          minY: 0,
          maxY: 0,
          shift: 0,
        });
      }
      this.firstWalk(child.id, depth + 1, ancestorShift);
    }

    // 2. Shift siblings apart to avoid overlap (accumulate shift only)
    let prevChild = children[0];
    for (let i = 1; i < children.length; i++) {
      const child = children[i];
      this.ensureSiblingSpacing(prevChild, child, ancestorShift);
      prevChild = child;
    }

    // 3. Center parent on its children's true positions (first/last define extent)
    const first = children[0];
    const last = children[children.length - 1];
    const firstRT = this.rt.get(first.id)!;
    const lastRT = this.rt.get(last.id)!;
    // True position = ancestorShift + child.shift + prelim
    const firstTrueY = ancestorShift + firstRT.shift + firstRT.prelim;
    const lastTrueY = ancestorShift + lastRT.shift + lastRT.prelim;
    const firstCenter = firstTrueY + this.estimateNodeHeight(first) / 2;
    const lastCenter = lastTrueY + this.estimateNodeHeight(last) / 2;
    // Parent prelim is relative to parent's ancestor shift
    this.rt.get(nodeId)!.prelim = (firstCenter + lastCenter) / 2 -
      ancestorShift;

    // 4. Cache subtree bounds relative to this node's prelim origin (O(children))
    // Each child's true extent in the ancestorShift frame is:
    //   [shift + prelim + minY, shift + prelim + maxY]
    // We store bounds relative to our own prelim so they're usable by
    // ensureSiblingSpacing at the next level up.
    //
    // CRITICAL: include this node's OWN extent (0..h) in addition to children.
    // Without this, a parent whose height exceeds its children's span would have
    // an undersized bounding box, causing sibling overlap.
    const r = this.rt.get(nodeId)!;
    const selfH = this.estimateNodeHeight(node);
    const parentPrelim = r.prelim;
    let subtreeMin = 0,
      subtreeMax = selfH; // Start with the node's own extent
    for (const child of children) {
      const cr = this.rt.get(child.id)!;
      subtreeMin = Math.min(
        subtreeMin,
        cr.shift + cr.prelim + cr.minY - parentPrelim,
      );
      subtreeMax = Math.max(
        subtreeMax,
        cr.shift + cr.prelim + cr.maxY - parentPrelim,
      );
    }
    r.minY = subtreeMin;
    r.maxY = subtreeMax;
  }

  /**
   * Ensure siblings don't overlap using subtree bounding boxes.
   *
   * True extent of a node's subtree:
   *   top    = ancestorShift + shift + prelim + minY
   *   bottom = ancestorShift + shift + prelim + maxY
   *
   * In our L→R layout (X=depth), nodes at different depths are on different
   * columns and can't visually overlap. Bounding-box spacing between adjacent
   * siblings guarantees no same-depth collisions because:
   * - If subtree-A.bottom <= subtree-B.top, then every node in A's subtree
   *   is above every node in B's subtree at matching depth levels.
   *
   * Only accumulates shift on the later sibling (no prelim mutation).
   */
  private ensureSiblingSpacing(
    earlier: GraphNode,
    later: GraphNode,
    ancestorShift: number,
  ): void {
    const earlierRT = this.rt.get(earlier.id)!;
    const laterRT = this.rt.get(later.id)!;
    // minY/maxY are relative to each node's own prelim origin, so include prelim
    const earlierTrueBottom = ancestorShift + earlierRT.shift +
      earlierRT.prelim + earlierRT.maxY;
    const laterTrueTop = ancestorShift + laterRT.shift + laterRT.prelim +
      laterRT.minY;
    const needed = earlierTrueBottom + this.config.verticalSpacing;

    if (laterTrueTop < needed) {
      // Accumulate the additional shift needed (no immediate prelim mutation)
      laterRT.shift += needed - laterTrueTop;
    }
  }

  // ------------------------------------------------------------------
  // RT helpers
  // ------------------------------------------------------------------

  /**
   * Propagate accumulated shifts top-down and finalize absolute positions (O(n)).
   *
   * Shifts are additive constants — applying them preserves all relative
   * positions computed during firstWalk, so no re-centering is needed.
   */
  private applyShifts(nodeId: number, ancestorAccumShift: number): void {
    const r = this.rt.get(nodeId);
    if (!r) return;

    const node = this.nodeMap.get(nodeId);
    if (!node) return;

    // Final accumulated shift for this node
    const accShift = ancestorAccumShift + r.shift;

    // Convert relative prelim to final absolute Y position
    r.prelim += accShift;

    // Propagate accumulated shift to descendants
    for (const child of this.getLayoutChildren(nodeId, node.collapsed)) {
      if (this.rt.has(child.id)) {
        this.applyShifts(child.id, accShift);
      }
    }
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
      .map((id: number) => this.nodeMap.get(id))
      .filter(
        (n: GraphNode | undefined): n is GraphNode => n !== undefined,
      )
      .filter((child: GraphNode) => {
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
