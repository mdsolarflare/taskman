/**
 * Graph Layout Engine
 *
 * Computes positions for graph nodes using a hierarchical tree layout algorithm.
 * Optimized for performance with memoization and batched calculations.
 */

import type { Graph, GraphNode, LayoutConfig } from "../types/graph";
import { DEFAULT_LAYOUT } from "../types/graph";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_NODE_HEIGHT = 40;
const FIELD_HEIGHT_DETAILS = 28;
const FIELD_HEIGHT_DEADLINE = 24;

// ---------------------------------------------------------------------------
// Layout State
// ---------------------------------------------------------------------------

interface LayoutNode {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  isCollapsed: boolean;
}

interface LayoutResult {
  nodes: Map<number, LayoutNode>;
  edges: Array<{ from: number; to: number }>;
  config: LayoutConfig;
}

// ---------------------------------------------------------------------------
// Layout Engine
// ---------------------------------------------------------------------------

export class LayoutEngine {
  private config: LayoutConfig;
  private nodeMap: Map<number, GraphNode>;
  private rootIds: number[] = [];
  private layoutCache: Map<number, LayoutResult> = new Map();
  private cacheKey: string = "";

  constructor(config: LayoutConfig = DEFAULT_LAYOUT) {
    this.config = config;
    this.nodeMap = new Map();
  }

  /**
   * Update the graph data and invalidate the cache.
   */
  setGraph(graph: Graph): void {
    this.nodeMap.clear();
    for (const node of graph.nodes) {
      this.nodeMap.set(node.id, node);
    }
    this.rootIds = graph.root_ids || [];
    this.invalidateCache();
  }

  /**
   * Update the layout configuration.
   */
  setConfig(config: Partial<LayoutConfig>): void {
    this.config = { ...this.config, ...config };
    this.invalidateCache();
  }

  /**
   * Compute the layout for the current graph.
   * Returns a map of node positions and edge connections.
   */
  computeLayout(): LayoutResult {
    const cacheKey = this.generateCacheKey();
    if (this.layoutCache.has(cacheKey)) {
      return this.layoutCache.get(cacheKey)!;
    }

    const layoutNodes = new Map<number, LayoutNode>();
    const edges: Array<{ from: number; to: number }> = [];

    // Process each root node and its subtree
    for (const rootId of this.rootIds) {
      const root = this.nodeMap.get(rootId);
      if (!root) continue;

      const subtree = this.layoutSubtree(rootId, 0, 0);
      for (const [id, node] of subtree.nodes) {
        layoutNodes.set(id, node);
      }
      edges.push(...subtree.edges);
    }

    const result: LayoutResult = {
      nodes: layoutNodes,
      edges,
      config: this.config,
    };

    this.layoutCache.set(cacheKey, result);
    return result;
  }

  /**
   * Layout a subtree rooted at the given node.
   * Uses a recursive approach to compute positions.
   */
  private layoutSubtree(
    nodeId: number,
    startX: number,
    startY: number,
  ): LayoutResult {
    const node = this.nodeMap.get(nodeId);
    if (!node) {
      return { nodes: new Map(), edges: [], config: this.config };
    }

    const isCollapsed = node.collapsed ?? true;
    const children = this.getVisibleChildren(node);

    // Compute node dimensions (estimated)
    const nodeWidth = this.estimateNodeWidth(node);
    const nodeHeight = this.estimateNodeHeight(node);

    // Create the layout node
    const layoutNode: LayoutNode = {
      id: nodeId,
      x: startX,
      y: startY,
      width: nodeWidth,
      height: nodeHeight,
      depth: 0,
      isCollapsed,
    };

    const result: LayoutResult = {
      nodes: new Map([[nodeId, layoutNode]]),
      edges: [],
      config: this.config,
    };

    if (!isCollapsed && children.length > 0) {
      // Pre-compute subtree heights for vertical centering
      const subtreeHeights = this.computeSubtreeHeights();

      let totalChildHeight = 0;
      for (const child of children) {
        totalChildHeight +=
          subtreeHeights.get(child.id)! + this.config.verticalSpacing;
      }
      totalChildHeight = Math.max(
        0,
        totalChildHeight - this.config.verticalSpacing,
      );

      // Start Y position for children (centered relative to parent)
      let currentY = startY - totalChildHeight / 2 + nodeHeight / 2;

      // Layout each child at its correct Y position
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const childResult = this.layoutSubtree(
          child.id,
          startX + this.config.horizontalSpacing,
          currentY,
        );

        // Add edge from parent to direct child only
        result.edges.push({ from: nodeId, to: child.id });

        // Merge child subtree nodes and internal edges into result
        for (const [id, layoutNode] of childResult.nodes) {
          result.nodes.set(id, layoutNode);
        }
        result.edges.push(...childResult.edges);

        // Move to next child position
        currentY += subtreeHeights.get(child.id)! + this.config.verticalSpacing;
      }
    }

    return result;
  }

  /**
   * Get visible children of a node (respecting collapse state).
   */
  private getVisibleChildren(node: GraphNode): GraphNode[] {
    if (!node.subtask_ids || node.subtask_ids.length === 0) {
      return [];
    }
    return node.subtask_ids
      .map((id) => this.nodeMap.get(id))
      .filter((n): n is GraphNode => n !== undefined);
  }

  /**
   * Memoized map for subtree height computation (avoids double traversal).
   */
  private subtreeHeightCache: Map<number, number> | null = null;

  /**
   * Compute the total rendered height of every node's visible subtree.
   * Result is cached so layoutSubtree can consume it without re-traversing.
   */
  private computeSubtreeHeights(): Map<number, number> {
    if (this.subtreeHeightCache) return this.subtreeHeightCache;
    const cache = new Map<number, number>();

    const compute = (nodeId: number): number => {
      if (cache.has(nodeId)) return cache.get(nodeId)!;
      const node = this.nodeMap.get(nodeId);
      if (!node) return 0;

      const selfHeight = this.estimateNodeHeight(node);
      const isCollapsed = node.collapsed ?? true;
      const children = this.getVisibleChildren(node);

      if (isCollapsed || children.length === 0) {
        cache.set(nodeId, selfHeight);
        return selfHeight;
      }

      let total = selfHeight;
      for (const child of children) {
        total += compute(child.id) + this.config.verticalSpacing;
      }
      // Remove trailing spacing
      total -= this.config.verticalSpacing;

      cache.set(nodeId, total);
      return total;
    };

    for (const rootId of this.rootIds) {
      compute(rootId);
    }

    this.subtreeHeightCache = cache;
    return cache;
  }

  /**
   * Estimate the width of a node based on its name length.
   */
  private estimateNodeWidth(node: GraphNode): number {
    // Approximate: 8px per character + padding, minimum matches NODE_WIDTH
    const nameWidth = node.name.length * 8;
    return Math.max(200, nameWidth + 32); // Minimum 200px width (NODE_WIDTH)
  }

  /**
   * Estimate the height of a node based on which fields are present.
   */
  private estimateNodeHeight(node: GraphNode): number {
    let height = BASE_NODE_HEIGHT;
    if (node.details) height += FIELD_HEIGHT_DETAILS;
    if (node.deadline) height += FIELD_HEIGHT_DEADLINE;
    return height;
  }

  /**
   * Generate a cache key based on current state.
   */
  private generateCacheKey(): string {
    const nodeIds = Array.from(this.nodeMap.keys()).sort().join(",");
    const collapseState = Array.from(this.nodeMap.values())
      .map((n) => `${n.id}:${n.collapsed ? 1 : 0}`)
      .join("|");
    return `${nodeIds}|${collapseState}|${this.config.horizontalSpacing}:${this.config.verticalSpacing}`;
  }

  /**
   * Invalidate the layout cache.
   */
  private invalidateCache(): void {
    this.layoutCache.clear();
    this.subtreeHeightCache = null;
  }

  /**
   * Get the position of a node by its ID.
   */
  getNodePosition(
    layout: LayoutResult,
    nodeId: number,
  ): { x: number; y: number } | null {
    const node = layout.nodes.get(nodeId);
    if (!node) return null;
    return { x: node.x, y: node.y };
  }

  /**
   * Clear the layout cache.
   */
  clearCache(): void {
    this.layoutCache.clear();
  }
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Create a new layout engine with default configuration.
 */
export function createLayoutEngine(
  config?: Partial<LayoutConfig>,
): LayoutEngine {
  return new LayoutEngine(config || DEFAULT_LAYOUT);
}

/**
 * Compute the bounding box of a layout.
 */
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

  for (const node of layout.nodes.values()) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
