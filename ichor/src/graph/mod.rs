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

    /// Delete a node from the graph.
    ///
    /// Algorithm (DAG-aware):
    /// 1. Reject if the node is a root (roots cannot be deleted)
    /// 2. Find all parents of the node being deleted
    /// 3. Find all children of the node being deleted
    /// 4. Re-map each child to ALL parents (DAG fan-out)
    /// 5. Remove the node from the graph
    /// 6. Clean up adjacency lists and rebuild root_ids
    pub fn delete_node(&mut self, node_id: i64) -> Result<(), String> {
        // Check if node exists
        if !self.nodes.iter().any(|n| n.id == node_id) {
            return Err(format!("Node with id {} not found", node_id));
        }

        // Roots cannot be deleted
        if self.root_ids.contains(&node_id) {
            let node = self.nodes.iter().find(|n| n.id == node_id).unwrap();
            return Err(format!(
                "Cannot delete root node '{}'. Root nodes cannot be removed.",
                node.name
            ));
        }

        // Collect children and parents before modification
        let children: Vec<i64> = self.adjacency.get(&node_id).cloned().unwrap_or_default();
        let parents: Vec<i64> = self
            .reverse_adjacency
            .get(&node_id)
            .cloned()
            .unwrap_or_default();

        // Re-map each child to ALL parents (DAG fan-out)
        for child_id in &children {
            // Build the new parent set: existing parents minus the deleted node, plus all parents of the deleted node
            let mut child_parents = self
                .reverse_adjacency
                .get(child_id)
                .cloned()
                .unwrap_or_default();
            child_parents.retain(|&pid| pid != node_id);
            for parent_id in &parents {
                if !child_parents.contains(parent_id) {
                    child_parents.push(*parent_id);
                }
            }
            *self
                .reverse_adjacency
                .entry(*child_id)
                .or_insert_with(Vec::new) = child_parents;

            // Update the child node's parent_ids field
            if let Some(child_node) = self.nodes.iter_mut().find(|n| n.id == *child_id) {
                let mut pids = child_node.parent_ids.clone().unwrap_or_default();
                pids.retain(|&pid| pid != node_id);
                for parent_id in &parents {
                    if !pids.contains(parent_id) {
                        pids.push(*parent_id);
                    }
                }
                child_node.parent_ids = Some(pids);
            }

            // Update each parent's subtask_ids (adjacency) to include this child
            for parent_id in &parents {
                if let Some(parent_node) = self.nodes.iter_mut().find(|n| n.id == *parent_id) {
                    let mut subtasks = parent_node.subtask_ids.clone().unwrap_or_default();
                    if !subtasks.contains(child_id) {
                        subtasks.push(*child_id);
                    }
                    parent_node.subtask_ids = Some(subtasks);
                }
                self.adjacency.entry(*parent_id).or_insert_with(Vec::new);
                let parent_children = self.adjacency.get_mut(parent_id).unwrap();
                if !parent_children.contains(child_id) {
                    parent_children.push(*child_id);
                }
            }
        }

        // Remove the node from the nodes list
        self.nodes.retain(|n| n.id != node_id);

        // Clean up adjacency: remove the deleted node as a parent entry
        self.adjacency.remove(&node_id);

        // Clean up reverse_adjacency: remove the deleted node as a child entry
        self.reverse_adjacency.remove(&node_id);

        // Also remove the deleted node from all other nodes' adjacency/reverse_adjacency
        for children_list in self.adjacency.values_mut() {
            children_list.retain(|&cid| cid != node_id);
        }
        for parents_list in self.reverse_adjacency.values_mut() {
            parents_list.retain(|&pid| pid != node_id);
        }

        // Update all parent_ids on remaining nodes to remove the deleted node
        for node in self.nodes.iter_mut() {
            if let Some(ref mut pids) = node.parent_ids {
                pids.retain(|&pid| pid != node_id);
            }
        }

        // Update all subtask_ids on remaining nodes to remove the deleted node
        for node in self.nodes.iter_mut() {
            if let Some(ref mut subtasks) = node.subtask_ids {
                subtasks.retain(|&sid| sid != node_id);
            }
        }

        // Rebuild root_ids: nodes not referenced as subtasks by any other node
        let mut referenced_ids = std::collections::HashSet::new();
        for node in &self.nodes {
            if let Some(ref subtask_ids) = node.subtask_ids {
                for sub_id in subtask_ids {
                    referenced_ids.insert(*sub_id);
                }
            }
        }
        self.root_ids = self
            .nodes
            .iter()
            .filter(|n| !referenced_ids.contains(&n.id))
            .map(|n| n.id)
            .collect();

        Ok(())
    }

    /// Add a new node to the graph.
    ///
    /// If `parent_id` is `Some`, the new node becomes a child of that parent.
    /// If `parent_id` is `None`, the new node is added as a root.
    ///
    /// Returns the ID of the newly created node.
    pub fn add_node(
        &mut self,
        parent_id: Option<i64>,
        name: String,
        details: Option<String>,
        deadline: Option<String>,
        important: Option<bool>,
        subtask_ids: Option<Vec<i64>>,
    ) -> Result<i64, String> {
        // Generate new ID: max existing ID + 1
        let new_id = if let Some(max_id) = self.nodes.iter().map(|n| n.id).max() {
            max_id + 1
        } else {
            1 // First node in an empty graph
        };

        // Validate parent exists if provided
        if let Some(pid) = parent_id {
            if !self.nodes.iter().any(|n| n.id == pid) {
                return Err(format!("Parent node with id {} not found", pid));
            }
        }

        // Build parent_ids for new node
        let node_parent_ids = parent_id.map(|pid| vec![pid]);

        // Create the new node
        let new_node = GraphNode {
            id: new_id,
            name,
            details,
            deadline,
            important,
            subtask_ids,
            parent_ids: node_parent_ids,
            collapsed: Some(false),
        };

        // Update parent's subtask_ids if parent exists
        if let Some(pid) = parent_id {
            if let Some(parent) = self.nodes.iter_mut().find(|n| n.id == pid) {
                let subtasks = parent.subtask_ids.get_or_insert_with(Vec::new);
                if !subtasks.contains(&new_id) {
                    subtasks.push(new_id);
                }
            }
            // Update adjacency list (parent -> child)
            self.adjacency.entry(pid).or_insert_with(Vec::new);
            self.adjacency.get_mut(&pid).unwrap().push(new_id);
            // Update reverse adjacency (child -> parent)
            self.reverse_adjacency
                .entry(new_id)
                .or_insert_with(Vec::new);
            self.reverse_adjacency.get_mut(&new_id).unwrap().push(pid);
            // New node is not a root - remove from root_ids if somehow present
            self.root_ids.retain(|&id| id != new_id);
        } else {
            // No parent - this is a new root
            self.root_ids.push(new_id);
        }

        // Handle subtask_ids - update adjacency for any subtasks
        if let Some(ref sub_ids) = new_node.subtask_ids {
            for sub_id in sub_ids {
                // Update reverse adjacency for each subtask
                self.reverse_adjacency
                    .entry(*sub_id)
                    .or_insert_with(Vec::new);
                self.reverse_adjacency.get_mut(sub_id).unwrap().push(new_id);
            }
            self.adjacency.insert(new_id, sub_ids.clone());
        }

        self.nodes.push(new_node);
        Ok(new_id)
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

/// Delete a node from the graph.
///
/// Returns the updated graph as JSON, or an error string.
#[wasm_bindgen]
pub fn delete_node(graph_json: &str, node_id: i64) -> Result<JsValue, JsValue> {
    let mut graph = Graph::from_json(graph_json)
        .map_err(|e| JsValue::from_str(&format!("JSON error: {}", e)))?;

    graph
        .delete_node(node_id)
        .map_err(|e| JsValue::from_str(&e))?;

    let json = graph
        .to_json()
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(JsValue::from_str(&json))
}

/// Add a new node to the graph.
///
/// `parent_id` of `-1` means no parent (new root node).
/// Returns the updated graph as JSON, or an error string.
#[wasm_bindgen]
pub fn add_node(
    graph_json: &str,
    parent_id: i64,
    name: &str,
    details: &str,
    deadline: &str,
    important: bool,
    subtask_ids_json: &str,
) -> Result<JsValue, JsValue> {
    let mut graph = Graph::from_json(graph_json)
        .map_err(|e| JsValue::from_str(&format!("JSON error: {}", e)))?;

    // -1 sentinel means no parent (root node)
    let pid = if parent_id == -1 {
        None
    } else {
        Some(parent_id)
    };

    // Parse optional subtask_ids from JSON array string
    let sub_ids: Option<Vec<i64>> = if subtask_ids_json.trim().is_empty() {
        None
    } else {
        serde_json::from_str(subtask_ids_json)
            .ok()
            .filter(|v: &Vec<i64>| !v.is_empty())
    };

    let new_id = graph
        .add_node(
            pid,
            name.to_string(),
            if details.trim().is_empty() {
                None
            } else {
                Some(details.to_string())
            },
            if deadline.trim().is_empty() {
                None
            } else {
                Some(deadline.to_string())
            },
            Some(important),
            sub_ids,
        )
        .map_err(|e| JsValue::from_str(&e))?;

    // Return both the updated graph JSON and the new node's ID
    let json = graph
        .to_json()
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    // Wrap in a JSON object with both graph and new_id
    let result = serde_json::json!({ "graph": serde_json::from_str::<serde_json::Value>(&json).map_err(|e| JsValue::from_str(&e.to_string()))?, "new_id": new_id });
    Ok(JsValue::from_str(&result.to_string()))
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_node(id: i64, name: &str, subtasks: Vec<i64>) -> GraphNode {
        GraphNode {
            id,
            name: name.to_string(),
            details: None,
            deadline: None,
            important: None,
            subtask_ids: if subtasks.is_empty() {
                None
            } else {
                Some(subtasks)
            },
            parent_ids: None,
            collapsed: Some(false),
        }
    }

    fn build_graph_from_yaml_str(yaml: &str) -> Graph {
        let doc: crate::yaml::TaskDocument =
            serde_yaml::from_str(yaml).expect("Failed to parse YAML");
        let graph_nodes = GraphBuilder::nodes_from_yaml(doc.nodes);
        Graph::from_nodes(graph_nodes)
    }

    #[test]
    fn test_delete_non_root_node_basic() {
        // Simple chain: A (root) -> B -> C (leaf)
        let yaml = r#"
nodes:
  - id: 1
    name: A
    subtask_ids: [2]
  - id: 2
    name: B
    subtask_ids: [3]
  - id: 3
    name: C
"#;
        let mut graph = build_graph_from_yaml_str(yaml);

        // Verify initial state
        assert!(graph.root_ids.contains(&1), "A should be root");
        assert!(!graph.root_ids.contains(&2), "B should not be root");
        assert!(!graph.root_ids.contains(&3), "C should not be root");
        assert_eq!(graph.nodes.len(), 3);

        // Delete B (node 2)
        graph.delete_node(2).expect("Failed to delete B");

        // After deletion: A -> C (B's children re-map to B's parents)
        assert_eq!(graph.nodes.len(), 2, "Should have 2 nodes left");
        assert!(graph.root_ids.contains(&1), "A should still be root");
        assert!(!graph.root_ids.contains(&3), "C should not be root anymore");

        // A should now have C as a subtask
        let a_node = graph
            .nodes
            .iter()
            .find(|n| n.id == 1)
            .expect("A should exist");
        assert!(
            a_node
                .subtask_ids
                .as_ref()
                .map_or(false, |ids| ids.contains(&3)),
            "A should now have C as subtask"
        );

        // C should have A as parent
        let c_node = graph
            .nodes
            .iter()
            .find(|n| n.id == 3)
            .expect("C should exist");
        assert!(
            c_node
                .parent_ids
                .as_ref()
                .map_or(false, |ids| ids.contains(&1)),
            "C should now have A as parent"
        );
    }

    #[test]
    fn test_delete_root_node_rejected() {
        let yaml = r#"
nodes:
  - id: 1
    name: A
    subtask_ids: [2]
  - id: 2
    name: B
"#;
        let mut graph = build_graph_from_yaml_str(yaml);

        // Try to delete root node A
        let result = graph.delete_node(1);
        assert!(result.is_err(), "Deleting root should fail");

        let err_msg = result.unwrap_err();
        assert!(
            err_msg.contains("Cannot delete root node"),
            "Error should mention root node protection"
        );
    }

    #[test]
    fn test_delete_nonexistent_node() {
        let yaml = r#"
nodes:
  - id: 1
    name: A
  - id: 2
    name: B
"#;
        let mut graph = build_graph_from_yaml_str(yaml);

        // Try to delete node 999 which doesn't exist
        let result = graph.delete_node(999);
        assert!(result.is_err(), "Deleting non-existent node should fail");

        let err_msg = result.unwrap_err();
        assert!(
            err_msg.contains("not found"),
            "Error should mention node not found"
        );
    }

    #[test]
    fn test_delete_remapping_children_to_all_parents() {
        // DAG structure:
        //   A     B
        //    \   /
        //     C
        //     |
        //     D
        //
        // Deleting C should remap D to both A and B
        let yaml = r#"
nodes:
  - id: 1
    name: A
    subtask_ids: [3]
  - id: 2
    name: B
    subtask_ids: [3]
  - id: 3
    name: C
    subtask_ids: [4]
  - id: 4
    name: D
"#;
        let mut graph = build_graph_from_yaml_str(yaml);

        // Delete C
        graph.delete_node(3).expect("Failed to delete C");

        // After deletion: A -> D, B -> D (D remaps to all of C's parents)
        assert_eq!(graph.nodes.len(), 3, "Should have 3 nodes left");

        // A should have D as subtask
        let a_node = graph
            .nodes
            .iter()
            .find(|n| n.id == 1)
            .expect("A should exist");
        assert!(
            a_node
                .subtask_ids
                .as_ref()
                .map_or(false, |ids| ids.contains(&4)),
            "A should now have D as subtask"
        );

        // B should have D as subtask
        let b_node = graph
            .nodes
            .iter()
            .find(|n| n.id == 2)
            .expect("B should exist");
        assert!(
            b_node
                .subtask_ids
                .as_ref()
                .map_or(false, |ids| ids.contains(&4)),
            "B should now have D as subtask"
        );

        // D should have both A and B as parents
        let d_node = graph
            .nodes
            .iter()
            .find(|n| n.id == 4)
            .expect("D should exist");
        let d_parents = d_node.parent_ids.as_ref().expect("D should have parents");
        assert!(d_parents.contains(&1), "D should have A as parent");
        assert!(d_parents.contains(&2), "D should have B as parent");
    }

    #[test]
    fn test_delete_node_with_multiple_parents() {
        // Complex DAG:
        //   A     B
        //    \   / \
        //     C     \
        //      \    /
        //       D
        //
        // Deleting C should remap D to both A and B
        let yaml = r#"
nodes:
  - id: 1
    name: A
    subtask_ids: [3]
  - id: 2
    name: B
    subtask_ids: [3, 4]
  - id: 3
    name: C
    subtask_ids: [4]
  - id: 4
    name: D
"#;
        let mut graph = build_graph_from_yaml_str(yaml);

        // Delete C
        graph.delete_node(3).expect("Failed to delete C");

        assert_eq!(graph.nodes.len(), 3, "Should have 3 nodes left");

        // D should already have B as parent, and gain A as parent from C's deletion
        let d_node = graph
            .nodes
            .iter()
            .find(|n| n.id == 4)
            .expect("D should exist");
        let d_parents = d_node.parent_ids.as_ref().expect("D should have parents");
        assert!(
            d_parents.contains(&1),
            "D should have A as parent (via remap from C)"
        );
        assert!(d_parents.contains(&2), "D should still have B as parent");

        // A should now have D as subtask
        let a_node = graph
            .nodes
            .iter()
            .find(|n| n.id == 1)
            .expect("A should exist");
        assert!(
            a_node
                .subtask_ids
                .as_ref()
                .map_or(false, |ids| ids.contains(&4)),
            "A should now have D as subtask"
        );

        // B should still have D as subtask (no duplicate)
        let b_node = graph
            .nodes
            .iter()
            .find(|n| n.id == 2)
            .expect("B should exist");
        let b_subtasks = b_node.subtask_ids.as_ref().expect("B should have subtasks");
        assert!(b_subtasks.contains(&4), "B should still have D as subtask");
        // Ensure no duplicate entries
        let d_count = b_subtasks.iter().filter(|&&id| id == 4).count();
        assert_eq!(d_count, 1, "B should have exactly one reference to D");
    }

    #[test]
    fn test_delete_leaf_node() {
        // A -> B (B is a leaf with no children)
        let yaml = r#"
nodes:
  - id: 1
    name: A
    subtask_ids: [2]
  - id: 2
    name: B
"#;
        let mut graph = build_graph_from_yaml_str(yaml);

        // Delete leaf node B
        graph.delete_node(2).expect("Failed to delete B");

        assert_eq!(graph.nodes.len(), 1, "Should have 1 node left");

        // A should have no more subtasks
        let a_node = graph
            .nodes
            .iter()
            .find(|n| n.id == 1)
            .expect("A should exist");
        assert!(
            a_node.subtask_ids.as_ref().map_or(true, Vec::is_empty),
            "A should have no subtasks left"
        );

        // Adjacency should be cleaned up
        assert!(
            !graph.adjacency.contains_key(&1)
                || graph.adjacency.get(&1).map_or(false, |ids| ids.is_empty()),
            "A should have no children in adjacency"
        );
    }

    #[test]
    fn test_delete_middle_of_deep_chain() {
        // Deep chain: A -> B -> C -> D -> E
        let yaml = r#"
nodes:
  - id: 1
    name: A
    subtask_ids: [2]
  - id: 2
    name: B
    subtask_ids: [3]
  - id: 3
    name: C
    subtask_ids: [4]
  - id: 4
    name: D
    subtask_ids: [5]
  - id: 5
    name: E
"#;
        let mut graph = build_graph_from_yaml_str(yaml);

        // Delete C (middle of chain)
        graph.delete_node(3).expect("Failed to delete C");

        // After deletion: A -> B -> D -> E (C removed, D remaps to B)
        assert_eq!(graph.nodes.len(), 4, "Should have 4 nodes left");

        // B should now have D as subtask
        let b_node = graph
            .nodes
            .iter()
            .find(|n| n.id == 2)
            .expect("B should exist");
        assert!(
            b_node
                .subtask_ids
                .as_ref()
                .map_or(false, |ids| ids.contains(&4)),
            "B should now have D as subtask"
        );

        // D should have B as parent
        let d_node = graph
            .nodes
            .iter()
            .find(|n| n.id == 4)
            .expect("D should exist");
        assert!(
            d_node
                .parent_ids
                .as_ref()
                .map_or(false, |ids| ids.contains(&2)),
            "D should now have B as parent"
        );
    }

    #[test]
    fn test_delete_single_root_node_fails() {
        // Single node graph - this is a root, so deletion should fail
        let yaml = r#"
nodes:
  - id: 1
    name: OnlyNode
"#;
        let mut graph = build_graph_from_yaml_str(yaml);

        let result = graph.delete_node(1);
        assert!(result.is_err(), "Deleting the only (root) node should fail");
    }

    #[test]
    fn test_delete_updates_adjacency_correctly() {
        // A -> B -> C
        //      \-> D
        // Deleting B should remap both C and D to A
        let yaml = r#"
nodes:
  - id: 1
    name: A
    subtask_ids: [2]
  - id: 2
    name: B
    subtask_ids: [3, 4]
  - id: 3
    name: C
  - id: 4
    name: D
"#;
        let mut graph = build_graph_from_yaml_str(yaml);

        graph.delete_node(2).expect("Failed to delete B");

        assert_eq!(graph.nodes.len(), 3, "Should have 3 nodes left");

        // A should have both C and D as subtasks
        let a_node = graph
            .nodes
            .iter()
            .find(|n| n.id == 1)
            .expect("A should exist");
        let a_subtasks = a_node.subtask_ids.as_ref().expect("A should have subtasks");
        assert!(a_subtasks.contains(&3), "A should have C as subtask");
        assert!(a_subtasks.contains(&4), "A should have D as subtask");

        // Adjacency list for A should contain C and D
        let a_adj = graph
            .adjacency
            .get(&1)
            .expect("A should have adjacency entry");
        assert!(a_adj.contains(&3), "A adjacency should contain C");
        assert!(a_adj.contains(&4), "A adjacency should contain D");

        // B should be completely removed from adjacency
        assert!(
            !graph.adjacency.contains_key(&2),
            "B should not be in adjacency"
        );
        assert!(
            !graph.reverse_adjacency.contains_key(&2),
            "B should not be in reverse_adjacency"
        );
    }
}
