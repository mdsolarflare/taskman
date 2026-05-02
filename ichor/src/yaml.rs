//! YAML data model parsing module.
//!
//! Defines the data structures and parsing logic for the task graph YAML format.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

// ---------------------------------------------------------------------------
// Data Model
// ---------------------------------------------------------------------------

/// A node in the task graph.
///
/// All fields except `id` and `name` are optional — a "leaf" node simply
/// omits `details`, `important`, and `subtask_ids`. There is no separate
/// Subtask type; every node is a Task with varying levels of detail.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: i64,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub important: Option<bool>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub subtask_ids: Vec<i64>,
}

/// Legacy alias — kept for import compatibility.
pub type Task = Node;

/// The root document structure for tasks.yaml.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskDocument {
    pub nodes: Vec<Node>,
}

// ---------------------------------------------------------------------------
// Public WASM API
// ---------------------------------------------------------------------------

/// Parse a YAML string into a TaskDocument.
///
/// Returns `Ok(String)` with a JSON-serialized representation of the document,
/// or `Err(String)` if parsing fails.
#[wasm_bindgen]
pub fn parse_yaml(yaml: &str) -> Result<String, String> {
    let doc: TaskDocument =
        serde_yaml::from_str(yaml).map_err(|e| format!("YAML parse error: {}", e))?;
    serde_json::to_string_pretty(&doc).map_err(|e| format!("JSON serialization error: {}", e))
}

/// Parse a YAML string and return the raw JSON as a String (JS-friendly).
#[wasm_bindgen]
pub fn parse_yaml_to_json(yaml: &str) -> Result<JsValue, JsValue> {
    let doc: TaskDocument =
        serde_yaml::from_str(yaml).map_err(|e| JsValue::from_str(&format!("YAML error: {}", e)))?;
    let json = serde_json::to_string(&doc)
        .map_err(|e| JsValue::from_str(&format!("JSON error: {}", e)))?;
    Ok(JsValue::from_str(&json))
}

/// Get the number of nodes in the document.
#[wasm_bindgen]
pub fn node_count(json: &str) -> Result<u32, String> {
    let doc: TaskDocument = serde_json::from_str(json).map_err(|e| format!("JSON error: {}", e))?;
    Ok(doc.nodes.len() as u32)
}

/// Get the names of all root nodes (nodes not referenced as subtask_ids).
#[wasm_bindgen]
pub fn root_names(json: &str) -> Result<JsValue, JsValue> {
    let doc: TaskDocument =
        serde_json::from_str(json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let mut referenced_ids = std::collections::HashSet::new();
    for node in &doc.nodes {
        for id in &node.subtask_ids {
            referenced_ids.insert(*id);
        }
    }
    let roots: Vec<String> = doc
        .nodes
        .iter()
        .filter(|n| !referenced_ids.contains(&n.id))
        .map(|n| n.name.clone())
        .collect();
    let json = serde_json::to_string(&roots).map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(JsValue::from_str(&json))
}

// ---------------------------------------------------------------------------
// Deprecated helpers — direct field access replaces these.
// ---------------------------------------------------------------------------
