//! YAML data model parsing module.
//!
//! Defines the data structures and parsing logic for the task graph YAML format.

use serde::{Deserialize, Serialize};

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub done: Option<bool>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub subtask_ids: Vec<i64>,
}

/// The root document structure for tasks.yaml.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskDocument {
    pub nodes: Vec<Node>,
}
