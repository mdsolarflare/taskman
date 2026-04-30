# Data Model: Task Graph

## Storage Format: YAML

We have chosen **YAML** as the persistent storage format for the task graph. This decision prioritizes human readability, ease of version control, and implementation simplicity.

### Rejection of Binary Transport

A common optimization for high-performance graph engines is to use a binary schema for data transport. However, in a **local-first** architecture running on modern hardware, binary serialization/deserialization introduces significant overhead that often outweighs the benefits:

1.  **Double Serialization Cost**: To serialize to binary, we must first parse the source data into an intermediate structure, then convert that to bytes. To deserialize, we reverse the process. This CPU-intensive work often outweighs the benefits of smaller file size, especially for datasets of this scale.
2.  **Debugging Complexity**: Binary formats are opaque. Debugging data corruption or schema mismatches requires custom tools or verbose logging, whereas YAML can be inspected instantly.
3.  **Human-Centric Workflow**: Tasks are often edited manually or imported from other formats. YAML allows users to version control their tasks directly in Git without needing a specialized diff tool.

## File Structure

All task data is stored in a single file (e.g., `tasks.yaml`) to ensure atomicity and simplicity.

```yaml
nodes:
  # Tasks and Subtasks are stored in a single flat list
  - id: 1
    name: "Main Task"
    details: "Description of the main task"
    deadline: 2023-10-27T10:00:00Z
    important: true
    subtask_ids: [2, 3]
  - id: 2
    name: "Subtask A"
    deadline: 2023-10-26T10:00:00Z
  - id: 3
    name: "Subtask B"
    deadline: 2023-10-26T12:00:00Z
```

## Schema Definitions

### Node Base
All nodes share a common identifier:
*   `id` (int): Unique identifier.

### Task
Represents a full task unit.
*   `id` (int): Unique ID.
*   `name` (string, max 128 chars): Display name.
*   `details` (string, max 1024 chars): Detailed description.
*   `deadline` (datetime): ISO 8601 date/time.
*   `important` (bool): Flag for highlighting.
*   `subtask_ids` (list[int]): IDs of child nodes.

### Subtask
A minimal task unit.
*   `id` (int): Unique ID.
*   `name` (string, max 128 chars): Display name.
*   `deadline` (datetime): ISO 8601 date/time.

## Directed Graph Mapping

The file structure implicitly defines a **Directed Acyclic Graph (DAG)**:

1.  **Adjacency List**: The `subtask_ids` field acts as the adjacency list for outgoing edges from a parent task to its children.
2.  **Roots**: Nodes that are not referenced in any other node's `subtask_ids` list are considered **Roots**. We anticipate a limit of ~3 roots for the initial product scope.
3.  **Traversability**:
    *   **Downward**: Iterate `subtask_ids` to find children.
    *   **Upward**: Requires a reverse-index lookup built at load time (parent references), as the file format is strictly parent-to-child.