# Notes on Reingold-Tilford

Derived from a great blog post @ https://williamyaoh.com/posts/2023-04-22-drawing-trees-functionally.html

### **Algorithm Overview**
The Reingold-Tilford algorithm (1981) computes non-overlapping `(x, y)` coordinates for nodes in an m-ary tree to produce aesthetically consistent visualizations. It operates in `O(n)` time relative to the number of nodes and separates layout into two phases: calculating horizontal offsets between parent-child pairs via postorder traversal, then "petrifying" the structure by computing absolute x-coordinates from root-to-node paths.

### **Core Aesthetic Constraints**
The algorithm enforces four strict layout rules:
1. Nodes at identical depths share the same vertical (y) coordinate.
2. Left children are positioned strictly to the left of their parent; right children to the right.
3. Each parent is horizontally centered over its immediate children.
4. Subtree layouts remain invariant regardless of their position within the larger tree.

### **Coordinate Assignment & Layout Process**
- **Y-coordinates:** Assigned trivially using node depth.
- **X-coordinates:** Computed recursively. Left and right subtrees are initially positioned with overlapping roots, then separated by scanning their inner boundaries (contours) level-by-level. When the horizontal distance between corresponding contour nodes falls below a minimum threshold, the root offset is increased to push the subtrees apart. Once separation is resolved, the parent node is placed centered between them.

### **Contour Mechanics & Traversal**
- A **left contour** is the sequence of leftmost nodes at each depth level; the **right contour** is defined symmetrically. Contour length always equals `tree_height + 1`.
- During layout, the algorithm scans in lockstep down the *right contour of the left subtree* and the *left contour of the right subtree*, as these represent the closest approaching branches.
- In the original imperative implementation, "threads" (pointers from dead-end nodes to subsequent contour nodes) are created during recursion unwinding to enable efficient contour traversal without direct tree edges.

### **Functional Implementation Strategy**
Pure functional languages cannot safely mutate pointer-based threads. Instead, contours are explicitly constructed as lists using a recursive definition:
- For a node `t` with left subtree `T_l` and right subtree `T_r`:
  `contour_l(t) = [t] ++ contour_l(T_l) ++ drop(length(contour_l(T_l)), contour_l(T_r))`
- This formulation correctly handles height disparities: if the left subtree is shorter, the remaining levels are filled by the left contour of the right subtree. The right contour follows a symmetric rule.
- Contour scanning then proceeds directly over these lists, eliminating side effects and pointer manipulation while preserving algorithmic behavior.

### **Computational Complexity**
The algorithm guarantees `O(n)` time complexity:
- Contour construction at each node costs `s(t) = min[h(T_l), h(T_r)]`, proportional to the height of the shorter child subtree.
- Summing this cost across all nodes yields a total contour construction cost `S(T)` that exactly matches the original paper's recurrence: `F(T) = F(T_l) + F(T_r) + min[h(T_l), h(T_r)]`.
- Since `F(T)` is proven to be `O(n)`, and postorder traversal plus petrification are linear, the total runtime remains `O(n)` even with list-based contour construction.

### **Generalization to m-ary Trees**
For nodes with more than two children, the algorithm extends by storing horizontal distances between each adjacent pair of sibling subtrees. The contour scan is folded across all children to iteratively "clump" them together while maintaining the `O(n)` time bound.

### **Optimization & Data Structure Recommendations for Agents**
- While standard linked lists achieve linear time, agents processing large trees should consider persistent data structures like 2-3 finger trees or Okasaki’s implicit recursive slowdown deque for efficient concatenation and insertion.
- Contour construction can be fused with the contour scan: sequences can be built concurrently during recursion unwinding using only stack operations (`head`, `tail`, `cons`), though this increases implementation complexity.
- The algorithm requires no external graph libraries; it operates purely on tree topology and recursive state passing, making it highly suitable for functional or immutable agent architectures.
