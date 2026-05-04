//! Ichor: The Rust brain for the Task Graph engine.
//!
//! Provides YAML parsing, graph construction, and WASM bindings.

pub mod graph;
pub mod yaml;

use wasm_bindgen::prelude::*;

// Re-export yaml module's public WASM API
pub use yaml::node_count;
pub use yaml::parse_yaml_to_json;
pub use yaml::root_names;

// Re-export graph module's public WASM API
pub use graph::build_graph_from_yaml;
pub use graph::get_node_count;
pub use graph::get_root_names;
pub use graph::graph_to_yaml;

#[wasm_bindgen]
pub fn add(left: u64, right: u64) -> u64 {
    left + right
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_works() {
        let result = add(2, 2);
        assert_eq!(result, 4);
    }
}
