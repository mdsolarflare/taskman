/**
 * Graph type definitions for the Task Graph application.
 *
 * These types mirror the Rust data structures defined in the Ichor WASM module,
 * providing type safety for the frontend graph rendering and manipulation.
 */

// ---------------------------------------------------------------------------
// Node Types
// ---------------------------------------------------------------------------

/**
 * A node in the task graph with computed fields for rendering.
 *
 * All fields except `id` and `name` are optional. A "leaf" node simply omits
 * `details`, `important`, and `subtask_ids`. The `parent_ids` and `collapsed`
 * fields are computed at graph build time / by the UI.
 */
export interface GraphNode {
  /** Unique identifier for the node */
  id: number;

  /** Display name of the node (max 128 chars) */
  name: string;

  /** Detailed description (max 1024 chars, optional) */
  details?: string;

  /** ISO 8601 deadline date/time (optional) */
  deadline?: string;

  /** Flag for highlighting important nodes (optional) */
  important?: boolean;

  /** Flag marking the node as completed (optional) */
  done?: boolean;

  /** IDs of child nodes (optional — absent on leaf nodes) */
  subtask_ids?: number[];

  /** IDs of parent nodes, computed at graph build time */
  parent_ids?: number[];

  /** Whether the node is collapsed in the UI (default: true) */
  collapsed?: boolean;
}

// ---------------------------------------------------------------------------
// Graph Types
// ---------------------------------------------------------------------------

/**
 * A directed graph of task nodes.
 *
 * Contains all nodes, adjacency lists for traversal, and root node identification.
 */
export interface Graph {
  /** All nodes in the graph, indexed by their id */
  nodes: GraphNode[];

  /** Adjacency list: parent_id -> list of child_ids */
  adjacency: Record<number, number[]>;

  /** Reverse adjacency: child_id -> list of parent_ids */
  reverse_adjacency: Record<number, number[]>;

  /** Set of root node ids (nodes with no parents) */
  root_ids: number[];
}

// ---------------------------------------------------------------------------
// YAML Document Types
// ---------------------------------------------------------------------------

/**
 * Layout algorithm configuration for the graph renderer.
 */
export interface LayoutConfig {
  /** Horizontal spacing between parent and child columns (pixels) — static so bezier curves have predictable room */
  horizontalSpacing: number;

  /** Base vertical gap between siblings (pixels) — actual gap scales with subtree height at each level */
  verticalSpacing: number;

  /** Maximum width of the graph before forcing vertical layout */
  maxWidth: number;

  /** Animation duration for node transitions (milliseconds) */
  animationDuration: number;
}

/**
 * Default layout configuration for the graph renderer.
 */
export const DEFAULT_LAYOUT: LayoutConfig = {
  horizontalSpacing: 280,
  verticalSpacing: 32,
  maxWidth: 1200,
  animationDuration: 200,
};
