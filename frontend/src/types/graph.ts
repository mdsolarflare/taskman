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
 * The root document structure for tasks.yaml.
 *
 * Mirrors the TaskDocument struct from the Rust yaml module.
 */
export interface TaskDocument {
  /** List of all nodes in the graph — every node uses the same schema */
  nodes: Node[];
}

/**
 * A node in the task graph.
 *
 * All fields except `id` and `name` are optional. A "leaf" node simply omits
 * `details`, `important`, and `subtask_ids`. There is no separate Subtask type.
 */
export interface Node {
  /** Unique ID */
  id: number;

  /** Display name (max 128 chars) */
  name: string;

  /** Detailed description (max 1024 chars) */
  details?: string;

  /** ISO 8601 deadline date/time */
  deadline?: string;

  /** Flag for highlighting important tasks */
  important?: boolean;

  /** IDs of child nodes */
  subtask_ids?: number[];
}

/**
 * Legacy alias — kept for import compatibility.
 * @deprecated Use `Node` instead.
 */
export type Task = Node;

/**
 * Legacy alias — kept for import compatibility.
 * @deprecated Use `Node` instead.
 */
export type TaskNode = Node;

// ---------------------------------------------------------------------------
// UI State Types
// ---------------------------------------------------------------------------

/**
 * Represents the collapsed/expanded state of a node in the UI.
 */
export interface NodeState {
  /** Node ID */
  id: number;

  /** Whether the node is collapsed */
  collapsed: boolean;

  /** Position offset for rendering (optional, set during layout) */
  position?: {
    x: number;
    y: number;
  };
}

/**
 * The current viewport state of the graph canvas.
 */
export interface Viewport {
  /** X offset of the viewport */
  offsetX: number;

  /** Y offset of the viewport */
  offsetY: number;

  /** Zoom level (1.0 = 100%) */
  zoom: number;
}

/**
 * A selection state for nodes in the graph.
 */
export interface Selection {
  /** ID of the selected node, or null if nothing is selected */
  nodeId: number | null;

  /** Additional context for the selection (e.g., which panel is open) */
  context?: string;
}

// ---------------------------------------------------------------------------
// Event Types
// ---------------------------------------------------------------------------

/**
 * Event dispatched when a node is toggled (collapsed/expanded).
 */
export interface NodeToggleEvent {
  /** ID of the toggled node */
  nodeId: number;

  /** New collapsed state */
  collapsed: boolean;
}

/**
 * Event dispatched when the viewport is panned or zoomed.
 */
export interface ViewportChangeEvent {
  /** New X offset */
  offsetX: number;

  /** New Y offset */
  offsetY: number;

  /** New zoom level */
  zoom: number;
}

/**
 * Event dispatched when a node is selected.
 */
export interface NodeSelectEvent {
  /** ID of the selected node */
  nodeId: number | null;
}

/**
 * Event dispatched when a YAML file is loaded.
 */
export interface YamlLoadEvent {
  /** Whether the load was successful */
  success: boolean;

  /** Error message if loading failed */
  error?: string;

  /** Number of nodes in the loaded document */
  nodeCount?: number;
}

// ---------------------------------------------------------------------------
// Layout Types
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
