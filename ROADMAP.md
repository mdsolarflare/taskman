# Roadmap

## Handle Task Completion — Done vs Delete

**Status:** Punted (pending design decision)

Marking a task as "done" is semantically equivalent to deleting it from the active graph, but carries different user intent. A deleted node re-maps its children to its parent(s), which may not be the desired behavior for completed tasks — users likely want to preserve completion state rather than collapse the hierarchy.

**Key tension:** Delete removes a node and adopts its children into the parent(s). Completion should probably preserve the node in some archived/completed state, or at least distinguish itself visually and logically from a hard delete.

**Next steps:** Decide whether "done" is a flag on the node (e.g., `completed: true`), a separate view/filter, or a distinct graph operation that doesn't re-map children.
