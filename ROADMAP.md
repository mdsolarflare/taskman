# Roadmap

## Handle Task Completion — Done vs Delete

**Status:** Punted (pending design decision)

Marking a task as "done" is semantically equivalent to deleting it from the active graph, but carries different user intent. A deleted node re-maps its children to its parent(s), which may not be the desired behavior for completed tasks — users likely want to preserve completion state rather than collapse the hierarchy.

**Key tension:** Delete removes a node and adopts its children into the parent(s). Completion should probably preserve the node in some archived/completed state, or at least distinguish itself visually and logically from a hard delete.

**Next steps:** Decide whether "done" is a flag on the node (e.g., `completed: true`), a separate view/filter, or a distinct graph operation that doesn't re-map children.


## Add some form of node navigation
We think maybe a navigation pane with the task names listed out?

## Better button accessibility
when a node is selected,
the "+" key triggers add button
the "=" key triggers edit button

## Sort out the CI
on prs:
run all compile and test checks for rust and typescript
do we want to test build the website? maybe just wasm?
basically i think we don't want to pnpm install

## Improve the storage model
when working from the sample file, no changes are tracked, when working from new or opening a pre-existing file, we will clearly indicate the file being tracked. we will auto-save changes async to file.

## build a yaml repair tool
if files get corrupted and therefore cannot be loaded into the graph, we should have a non-destructive method of auto-repair.
