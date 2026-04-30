//! YAML data model parsing module.
//!
//! Defines the data structures and parsing logic for the task graph YAML format.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

// ---------------------------------------------------------------------------
// Data Model
// ---------------------------------------------------------------------------

/// A node in the task graph. Can be either a Task or a Subtask.
///
/// Uses untagged deserialization so `serde` tries each variant in order:
/// `Task` first (has optional `subtask_ids`, `details`, `important`), then
/// `Subtask` (only `id`, `name`, `deadline`). This matches the DATA_MODEL.md
/// spec which has no explicit `type` discriminator field.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Node {
    Task(Task),
    Subtask(Subtask),
}

/// A full task unit with details and subtasks.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
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

/// A minimal subtask unit.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subtask {
    pub id: i64,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<String>,
}

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
        match node {
            Node::Task(task) => {
                for id in &task.subtask_ids {
                    referenced_ids.insert(*id);
                }
            }
            Node::Subtask(_) => {}
        }
    }
    let roots: Vec<String> = doc
        .nodes
        .iter()
        .filter(|n| {
            let id = match n {
                Node::Task(t) => t.id,
                Node::Subtask(s) => s.id,
            };
            !referenced_ids.contains(&id)
        })
        .map(|n| n.name())
        .collect();
    let json = serde_json::to_string(&roots).map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(JsValue::from_str(&json))
}

// ---------------------------------------------------------------------------
// Node helper trait
// ---------------------------------------------------------------------------

impl Node {
    /// Get the name of the node.
    pub fn name(&self) -> String {
        match self {
            Node::Task(t) => t.name.clone(),
            Node::Subtask(s) => s.name.clone(),
        }
    }

    /// Get the id of the node.
    pub fn id(&self) -> i64 {
        match self {
            Node::Task(t) => t.id,
            Node::Subtask(s) => s.id,
        }
    }
}
