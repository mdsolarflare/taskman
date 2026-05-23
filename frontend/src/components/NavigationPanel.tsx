import { useEffect, useRef } from "react";
import type { GraphNode } from "../types/graph.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NavigationPanelProps {
  nodes: GraphNode[];
  selectedNodeId: number | null;
  onNodeSelect: (nodeId: number) => void;
  isOpen: boolean;
  colors: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NavigationPanel({
  nodes,
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

  const c = colors;

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
        {nodes.map((node) => {
          const isSelected = selectedNodeId === node.id;
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
                padding: "6px 12px",
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
                paddingLeft: isSelected ? 9 : 12,
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
              <span style={{ paddingRight: 6 }}>
                {node.important ? "!" : ""}
              </span>
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
    </aside>
  );
}
