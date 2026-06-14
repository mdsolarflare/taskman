/**
 * WASM Bridge Module
 *
 * Provides TypeScript-friendly interfaces to the Rust WASM module.
 * Uses wasm-pack's generated init function and typed exports directly.
 *
 * Usage:
 *   const graphJson = await buildGraphFromYaml(yamlString);
 */

import init, {
  add_node,
  build_graph_from_yaml,
  delete_node,
  graph_to_yaml,
} from "../public/dist/ichor.js";

// ---------------------------------------------------------------------------
// Initialization — eager at startup, cached for subsequent calls
// ---------------------------------------------------------------------------

let initialized = false;

/**
 * Initialize the WASM module. Called once before React renders so that all
 * subsequent WASM calls are guaranteed to succeed synchronously.
 *
 * Fetches bytes, compiles to a WebAssembly.Module, then passes it to wasm-pack's
 * async init. This avoids `instantiateStreaming` (blocked by CSP) while still
 * using the standard wasm-pack initialization path.
 */
export async function initWasm(): Promise<void> {
  if (initialized) return;

  const wasmUrl = new URL("ichor_bg.wasm", import.meta.url);
  const bytes = await fetch(wasmUrl).then((r) => r.arrayBuffer());
  const module = new WebAssembly.Module(bytes);
  await init({ module });
  initialized = true;
}

/**
 * Internal guard — should always be a no-op after `initWasm()` runs at startup.
 */
async function ensureInit(): Promise<void> {
  if (initialized) return;
  await initWasm();
}

// ---------------------------------------------------------------------------
// Public API — thin wrappers that ensure WASM is loaded, then call the typed
// wasm-pack exports directly. Each function returns parsed JSON (not raw strings)
// to match the existing App.tsx contract.
// ---------------------------------------------------------------------------

/**
 * Build a graph from a YAML string and return the result as a parsed JSON object.
 */
export async function buildGraphFromYaml(yaml: string): Promise<unknown> {
  await ensureInit();
  const result = build_graph_from_yaml(yaml);
  return JSON.parse(result as string);
}

/**
 * Convert a Graph JSON object back to the YAML data schema format.
 * Strips computed fields (adjacency, reverse_adjacency, root_ids, parent_ids, collapsed)
 * and returns a clean TaskDocument as a YAML string suitable for file save.
 */
export async function saveGraphToYaml(graph: unknown): Promise<string> {
  await ensureInit();
  const graphJson = JSON.stringify(graph);
  return graph_to_yaml(graphJson);
}

/**
 * Delete a node from the graph.
 * Returns the updated graph as a parsed JSON object, or throws an error string.
 */
export async function deleteNode(
  graph: unknown,
  nodeId: number,
): Promise<unknown> {
  await ensureInit();
  const graphJson = JSON.stringify(graph);
  const result = delete_node(graphJson, BigInt(nodeId));
  return JSON.parse(result as string);
}

/**
 * Add a new node to the graph.
 * `parentId` of -1 means no parent (new root node).
 * Returns an object with `graph` (updated graph) and `new_id` (id of the new node).
 */
export async function addNode(
  graph: unknown,
  parentId: number,
  name: string,
  details: string,
  deadline: string,
  important: boolean,
  done: boolean,
  subtaskIds: number[],
): Promise<{ graph: unknown; new_id: number }> {
  await ensureInit();
  const graphJson = JSON.stringify(graph);
  const subtaskIdsJson = subtaskIds.length > 0
    ? JSON.stringify(subtaskIds)
    : "";
  const result = add_node(
    graphJson,
    BigInt(parentId),
    name,
    details,
    deadline,
    important,
    done,
    subtaskIdsJson,
  );
  return JSON.parse(result as string);
}
