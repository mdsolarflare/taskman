//! Graph data structures and operations.
//!
//! Provides adjacency-based graph representation with traversal utilities
//! for the task graph model.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

// ---------------------------------------------------------------------------
// Graph Data Structures
// ---------------------------------------------------------------------------

/// A node in the task graph with all its properties.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: i64,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub important: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtask_ids: Option<Vec<i64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_ids: Option<Vec<i64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collapsed: Option<bool>,
}

/// A directed graph of task nodes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Graph {
    /// All nodes indexed by their id.
    pub nodes: Vec<GraphNode>,
    /// Adjacency list: parent_id -> list of child_ids
    pub adjacency: std::collections::HashMap<i64, Vec<i64>>,
    /// Reverse adjacency: child_id -> list of parent_ids
    pub reverse_adjacency: std::collections::HashMap<i64, Vec<i64>>,
    /// Set of root node ids (nodes with no parents)
    pub root_ids: Vec<i64>,
}

// ---------------------------------------------------------------------------
// Graph Construction
// ---------------------------------------------------------------------------

impl Graph {
    /// Build a graph from a list of nodes.
    ///
    /// Constructs the adjacency and reverse adjacency lists, and identifies
    /// root nodes (nodes not referenced as subtasks by any other node).
    ///
    /// Prevents full graph cycles by stripping root node IDs from all
    /// `subtask_ids` vectors — a root referencing itself or another root
    /// would break the DAG invariant.
    pub fn from_nodes(nodes: Vec<GraphNode>) -> Self {
        let mut adjacency: std::collections::HashMap<i64, Vec<i64>> =
            std::collections::HashMap::new();
        let mut reverse_adjacency: std::collections::HashMap<i64, Vec<i64>> =
            std::collections::HashMap::new();
        let mut referenced_ids: std::collections::HashSet<i64> = std::collections::HashSet::new();

        // Pass 1 — build adjacency and identify root nodes
        for node in &nodes {
            if let Some(ref subtask_ids) = node.subtask_ids {
                adjacency.insert(node.id, subtask_ids.clone());
                for sub_id in subtask_ids {
                    referenced_ids.insert(*sub_id);
                    reverse_adjacency
                        .entry(*sub_id)
                        .or_insert_with(Vec::new)
                        .push(node.id);
                }
            }
        }

        let root_ids: std::collections::HashSet<i64> = nodes
            .iter()
            .filter(|n| !referenced_ids.contains(&n.id))
            .map(|n| n.id)
            .collect();

        // Pass 2 — sanitize subtask_ids by removing any root node references
        let sanitized_nodes: Vec<GraphNode> = nodes
            .into_iter()
            .map(|mut node| {
                if let Some(ref mut subtask_ids) = node.subtask_ids {
                    subtask_ids.retain(|id| !root_ids.contains(id));
                    if subtask_ids.is_empty() {
                        node.subtask_ids = None;
                    }
                }
                node
            })
            .collect();

        // Rebuild adjacency from sanitized data
        let mut adjacency: std::collections::HashMap<i64, Vec<i64>> =
            std::collections::HashMap::new();
        let mut reverse_adjacency: std::collections::HashMap<i64, Vec<i64>> =
            std::collections::HashMap::new();

        for node in &sanitized_nodes {
            if let Some(ref subtask_ids) = node.subtask_ids {
                adjacency.insert(node.id, subtask_ids.clone());
                for sub_id in subtask_ids {
                    reverse_adjacency
                        .entry(*sub_id)
                        .or_insert_with(Vec::new)
                        .push(node.id);
                }
            }
        }

        let root_ids_vec: Vec<i64> = root_ids.into_iter().collect();

        Graph {
            nodes: sanitized_nodes,
            adjacency,
            reverse_adjacency,
            root_ids: root_ids_vec,
        }
    }

    /// Get children of a node by its id.
    pub fn get_children(&self, node_id: i64) -> Vec<&GraphNode> {
        if let Some(child_ids) = self.adjacency.get(&node_id) {
            child_ids
                .iter()
                .filter_map(|id| self.nodes.iter().find(|n| n.id == *id))
                .collect()
        } else {
            Vec::new()
        }
    }

    /// Get parents of a node by its id.
    pub fn get_parents(&self, node_id: i64) -> Vec<&GraphNode> {
        if let Some(parent_ids) = self.reverse_adjacency.get(&node_id) {
            parent_ids
                .iter()
                .filter_map(|id| self.nodes.iter().find(|n| n.id == *id))
                .collect()
        } else {
            Vec::new()
        }
    }

    /// Get a node by its id.
    pub fn get_node(&self, node_id: i64) -> Option<&GraphNode> {
        self.nodes.iter().find(|n| n.id == node_id)
    }

    /// Get all root nodes.
    pub fn get_root_nodes(&self) -> Vec<&GraphNode> {
        self.root_ids
            .iter()
            .filter_map(|id| self.nodes.iter().find(|n| n.id == *id))
            .collect()
    }

    /// Serialize the graph to JSON string.
    pub fn to_json(&self) -> Result<String, String> {
        serde_json::to_string_pretty(self).map_err(|e| format!("JSON error: {}", e))
    }

    /// Deserialize a graph from JSON string.
    pub fn from_json(json: &str) -> Result<Self, String> {
        serde_json::from_str(json).map_err(|e| format!("JSON error: {}", e))
    }
}

// ---------------------------------------------------------------------------
// Graph Builder (from YAML-parsed data)
// ---------------------------------------------------------------------------

/// Builder to construct a Graph from parsed YAML data.
pub struct GraphBuilder;

impl GraphBuilder {
    /// Convert a list of Node structs into GraphNode structs.
    pub fn nodes_from_yaml(nodes: Vec<crate::yaml::Node>) -> Vec<GraphNode> {
        nodes
            .into_iter()
            .map(|node| GraphNode {
                id: node.id,
                name: node.name,
                details: node.details,
                deadline: node.deadline,
                important: node.important,
                subtask_ids: if node.subtask_ids.is_empty() {
                    None
                } else {
                    Some(node.subtask_ids)
                },
                parent_ids: None, // Will be filled by Graph::from_nodes
                collapsed: Some(false),
            })
            .collect()
    }
}

// ---------------------------------------------------------------------------
// Public WASM API
// ---------------------------------------------------------------------------

/// Parse YAML and build a graph, returning JSON representation.
#[wasm_bindgen]
pub fn build_graph_from_yaml(yaml: &str) -> Result<JsValue, JsValue> {
    let doc: crate::yaml::TaskDocument =
        serde_yaml::from_str(yaml).map_err(|e| JsValue::from_str(&format!("YAML error: {}", e)))?;

    let graph_nodes = GraphBuilder::nodes_from_yaml(doc.nodes);
    let graph = Graph::from_nodes(graph_nodes);

    let json = graph
        .to_json()
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(JsValue::from_str(&json))
}

/// Parse YAML and return node count.
#[wasm_bindgen]
pub fn get_node_count(yaml: &str) -> Result<i64, String> {
    let doc: crate::yaml::TaskDocument =
        serde_yaml::from_str(yaml).map_err(|e| format!("YAML error: {}", e))?;
    Ok(doc.nodes.len() as i64)
}

/// Get root node names from YAML.
#[wasm_bindgen]
pub fn get_root_names(yaml: &str) -> Result<JsValue, JsValue> {
    let doc: crate::yaml::TaskDocument =
        serde_yaml::from_str(yaml).map_err(|e| JsValue::from_str(&e.to_string()))?;

    let graph_nodes = GraphBuilder::nodes_from_yaml(doc.nodes);
    let graph = Graph::from_nodes(graph_nodes);

    let names: Vec<String> = graph
        .get_root_nodes()
        .iter()
        .map(|n| n.name.clone())
        .collect();
    let json = serde_json::to_string(&names).map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(JsValue::from_str(&json))
}

/// Convert a Graph JSON back to the YAML data schema format.
///
/// Takes the full Graph JSON (with computed fields like adjacency, root_ids),
/// strips those computed fields, and serializes only the node data as a clean
/// TaskDocument in YAML format suitable for file save.
#[wasm_bindgen]
pub fn graph_to_yaml(graph_json: &str) -> Result<String, String> {
    let graph = Graph::from_json(graph_json)?;

    let nodes: Vec<crate::yaml::Node> = graph
        .nodes
        .iter()
        .map(|node| crate::yaml::Node {
            id: node.id,
            name: node.name.clone(),
            details: node.details.clone(),
            deadline: node.deadline.clone(),
            important: node.important,
            subtask_ids: node.subtask_ids.clone().unwrap_or_default(),
        })
        .collect();

    let doc = crate::yaml::TaskDocument { nodes };
    serde_yaml::to_string(&doc).map_err(|e| format!("YAML serialization error: {}", e))
}
