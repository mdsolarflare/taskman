//! Ichor: The Rust brain for the Task Graph engine.
//!
//! Provides YAML parsing, graph construction, and WASM bindings.

pub mod graph;
pub mod yaml;

// Re-export graph module's public WASM API
pub use graph::add_node;
pub use graph::build_graph_from_yaml;
pub use graph::delete_node;
pub use graph::get_node_count;
pub use graph::get_root_names;
pub use graph::graph_to_yaml;
