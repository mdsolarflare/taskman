import { useEffect, useMemo, useRef, useState } from "react";
import type { Graph, GraphNode } from "../types/graph.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Days before deadline to flag as "near" (overdue = 0, near = 0..14)
const NEAR_DEADLINE_DAYS = 14;

// Indentation per tree depth level
const DEPTH_INDENT = 16;

// Base padding before any indentation
const BASE_PADDING = 12;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NavigationPanelProps {
  graph: Graph;
  selectedNodeId: number | null;
  onNodeSelect: (nodeId: number) => void;
  isOpen: boolean;
  colors: Record<string, string>;
}

type DeadlineStatus = "overdue" | "near" | "ok";

interface TreeNode {
  node: GraphNode;
  depth: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDeadlineStatus(deadlineIso: string | undefined): DeadlineStatus {
  if (!deadlineIso) return "ok";
  try {
    const deadline = new Date(deadlineIso).getTime();
    const now = Date.now();
    const diffMs = deadline - now;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffDays < 0) return "overdue";
    if (diffDays <= NEAR_DEADLINE_DAYS) return "near";
    return "ok";
  } catch {
    return "ok";
  }
}

// Build a deterministic DFS traversal order from roots.
// Each entry carries the node and its tree depth.
function buildTreeOrder(graph: Graph): TreeNode[] {
  const result: TreeNode[] = [];
  const visited = new Set<number>();

  const visit = (nodeId: number, depth: number) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    result.push({ node, depth });

    const children = graph.adjacency[nodeId] ?? [];
    for (const childId of children) {
      visit(childId, depth + 1);
    }
  };

  for (const rootId of graph.root_ids) {
    visit(rootId, 0);
  }

  // Ensure we capture nodes that weren't reached from roots (orphaned nodes)
  for (const node of graph.nodes) {
    if (!visited.has(node.id)) {
      result.push({ node, depth: 0 });
      visited.add(node.id);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NavigationPanel({
  graph,
  selectedNodeId,
  onNodeSelect,
  isOpen,
  colors,
}: NavigationPanelProps) {
  const nodeRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view when selection changes
  useEffect(() => {
    if (selectedNodeId != null && nodeRefs.current[selectedNodeId]) {
      nodeRefs.current[selectedNodeId]?.scrollIntoView({
        block: "nearest",
      });
    }
  }, [selectedNodeId]);

  // Filter state
  const [searchText, setSearchText] = useState("");
  const [filterImportant, setFilterImportant] = useState(false);
  const [filterDeadline, setFilterDeadline] = useState(false);

  // Cached DFS tree order
  const treeOrder = useMemo(() => buildTreeOrder(graph), [graph]);

  // Filtered list (search + toggles)
  const filtered = useMemo(() => {
    const lowerSearch = searchText.toLowerCase();

    return treeOrder.filter(({ node }) => {
      if (lowerSearch && !node.name.toLowerCase().includes(lowerSearch)) {
        return false;
      }
      if (filterImportant && !node.important) {
        return false;
      }
      if (filterDeadline) {
        const status = getDeadlineStatus(node.deadline);
        if (status === "ok") return false;
      }
      return true;
    });
  }, [treeOrder, searchText, filterImportant, filterDeadline]);

  const c = colors;

  // Active filter count (for showing clear button)
  const hasActiveFilters = searchText || filterImportant || filterDeadline;

  return (
    <aside
      style={{
        width: isOpen ? 240 : 0,
        minWidth: isOpen ? 240 : 0,
        height: "100%",
        background: c["--bg-secondary"],
        borderLeft: isOpen
          ? `1px solid ${c["--border-color"]}`
          : "1px solid transparent",
        display: "flex",
        flexDirection: "column",
        transition:
          "width 0.2s ease, min-width 0.2s ease, border-color 0.2s ease",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {/* Header */}
      <div
        style={{
          height: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 12px",
          borderBottom: `1px solid ${c["--border-color"]}`,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: c["--text-secondary"],
            textTransform: "uppercase",
            letterSpacing: 0.5,
            whiteSpace: "nowrap",
            opacity: isOpen ? 1 : 0,
            transition: "opacity 0.15s ease",
          }}
        >
          Tasks
        </span>
      </div>

      {/* Filters */}
      <div
        style={{
          padding: "4px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          borderBottom: `1px solid ${c["--border-color"]}`,
          flexShrink: 0,
        }}
      >
        {/* Search input */}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
          }}
        >
          <input
            type="text"
            placeholder="Search…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{
              width: "100%",
              padding: "4px 24px 4px 8px",
              fontSize: 12,
              fontFamily: "system-ui, -apple-system, sans-serif",
              color: c["--text-primary"],
              background: c["--bg-primary"],
              border: `1px solid ${c["--border-color"]}`,
              borderRadius: 4,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          {/* Clear search button */}
          {searchText && (
            <button
              type="button"
              onClick={() => setSearchText("")}
              style={{
                position: "absolute",
                right: 4,
                top: "50%",
                transform: "translateY(-50%)",
                width: 16,
                height: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                border: "none",
                borderRadius: 2,
                cursor: "pointer",
                fontSize: 10,
                color: c["--text-secondary"],
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Toggle buttons */}
        <div style={{ display: "flex", gap: 4 }}>
          <ToggleBtn
            active={filterImportant}
            onClick={() => setFilterImportant((v) => !v)}
            label="!"
            title="Filter important tasks"
            colors={c}
          />
          <ToggleBtn
            active={filterDeadline}
            onClick={() => setFilterDeadline((v) => !v)}
            label="⏱"
            title="Filter near-deadline / overdue tasks"
            colors={c}
          />
        </div>
      </div>

      {/* Node list */}
      <div
        ref={listRef}
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          padding: "4px 0",
        }}
      >
        {filtered.map(({ node, depth }) => {
          const isSelected = selectedNodeId === node.id;
          const deadlineStatus = getDeadlineStatus(node.deadline);
          const paddingLeft = BASE_PADDING + depth * DEPTH_INDENT;

          return (
            <button
              key={node.id}
              type="button"
              ref={(el) => {
                nodeRefs.current[node.id] = el;
              }}
              onClick={() => onNodeSelect(node.id)}
              style={{
                display: "flex",
                alignItems: "center",
                width: "100%",
                padding: `6px ${isSelected ? 9 : paddingLeft}px`,
                paddingLeft: isSelected ? 9 : paddingLeft,
                fontSize: 13,
                fontFamily: "system-ui, -apple-system, sans-serif",
                color: isSelected ? c["--text-primary"] : c["--text-secondary"],
                background: isSelected ? c["--bg-primary"] : "transparent",
                border: "none",
                textAlign: "left",
                cursor: "pointer",
                borderRadius: 0,
                transition: "background 0.1s, color 0.1s",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                borderLeft: isSelected
                  ? `3px solid ${c["--accent"]}`
                  : "3px solid transparent",
                // Vertical connector line for nested items
                borderLeftStyle: depth > 0 && !isSelected ? "solid" : undefined,
                borderLeftColor: depth > 0 && !isSelected
                  ? c["--border-color"]
                  : isSelected
                  ? c["--accent"]
                  : "transparent",
                borderLeftWidth: depth > 0 ? 1 : isSelected ? 3 : 0,
                boxSizing: "border-box",
              }}
              onMouseEnter={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.background = c["--bg-primary"];
                }
              }}
              onMouseLeave={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.background = "transparent";
                }
              }}
            >
              {/* Deadline indicator dot */}
              {deadlineStatus !== "ok" && (
                <span
                  style={{
                    display: "inline-block",
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    marginRight: 4,
                    flexShrink: 0,
                    background: deadlineStatus === "overdue"
                      ? c["--semantic-overdue"]
                      : c["--semantic-overdue"],
                    opacity: deadlineStatus === "overdue" ? 1 : 0.5,
                  }}
                />
              )}

              {/* Important indicator */}
              {node.important && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    marginRight: 2,
                    flexShrink: 0,
                    color: c["--semantic-overdue"],
                  }}
                >
                  !
                </span>
              )}

              {/* Node name */}
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {node.name}
              </span>
            </button>
          );
        })}
      </div>

      {/* Footer with count */}
      <div
        style={{
          height: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 12px",
          borderTop: `1px solid ${c["--border-color"]}`,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: c["--text-secondary"],
            opacity: hasActiveFilters ? 1 : 0.6,
          }}
        >
          {filtered.length} / {graph.nodes.length} tasks
        </span>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ToggleBtn({
  active,
  onClick,
  label,
  title,
  colors,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  title: string;
  colors: Record<string, string>;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        padding: "3px 6px",
        fontSize: 11,
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontWeight: active ? 700 : 500,
        color: active ? colors["--accent"] : colors["--text-secondary"],
        background: active ? colors["--bg-primary"] : "transparent",
        border: `1px solid ${
          active ? colors["--accent"] : colors["--border-color"]
        }`,
        borderRadius: 3,
        cursor: "pointer",
        transition: "all 0.1s",
        lineHeight: 1,
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = colors["--bg-primary"];
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = "transparent";
        }
      }}
    >
      {label}
    </button>
  );
}
