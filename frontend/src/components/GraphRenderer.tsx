import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Graph, GraphNode } from "../types/graph.ts";
import { getLayoutBounds, LayoutEngine } from "../engine/layout.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NODE_WIDTH = 200;
const NODE_RADIUS = 6;
const VIEWPORT_X_OFFSET = 40; // Pixels from left edge of viewport to target node's left edge

// Graph color roles - mapped from CSS theme variables
interface GraphColors {
  bg: string;
  grid: string;
  nodeFill: string;
  nodeStroke: string;
  nodeHover: string;
  nodeHoverStroke: string;
  nodeSelected: string;
  nodeSelectedStroke: string;
  nodeImportant: string;
  nodeImportantStroke: string;
  text: string;
  textSubtle: string;
  edge: string;
  edgeActive: string;
  collapseIcon: string;
  toolbarBg: string;
  toolbarBorder: string;
  toolbarHover: string;
  toolbarText: string;
  toolbarActive: string;
  menuBg: string;
  menuBorder: string;
  menuHover: string;
  menuText: string;
  menuTextActive: string;
  menuBorderAccent: string;
  accent: string;
  overdue: string;
}

// Color scheme - read from CSS variables set by the active theme
function readGraphColors(): GraphColors {
  const cs = getComputedStyle(document.documentElement);
  const g = (v: string) => cs.getPropertyValue(v).trim();
  return {
    bg: g("--bg-primary") || "#fafafa",
    grid: g("--grid-color") || "#e8e8e8",
    nodeFill: g("--bg-secondary") || "#ffffff",
    nodeStroke: g("--border-color") || "#d0d0d0",
    nodeHover: g("--bg-primary") || "#f0f0ff",
    nodeHoverStroke: g("--accent") || "#8888ff",
    nodeSelected: g("--bg-secondary") || "#eef0ff",
    nodeSelectedStroke: g("--accent") || "#6366f1",
    nodeImportant: g("--semantic-important") || "#fff8e1",
    nodeImportantStroke: g("--semantic-important-stroke") || "#ffb300",
    text: g("--text-primary") || "#1a1a2e",
    textSubtle: g("--text-secondary") || "#6b7280",
    edge: g("--edge-color") || "#c5cae9",
    edgeActive: g("--edge-color") || "#8888ff",
    collapseIcon: g("--accent") || "#6366f1",
    toolbarBg: g("--bg-secondary") || "#ffffff",
    toolbarBorder: g("--border-color") || "#e5e7eb",
    toolbarHover: g("--bg-primary") || "#f3f4f6",
    toolbarText: g("--text-primary") || "#374151",
    toolbarActive: g("--accent") || "#6366f1",
    menuBg: g("--bg-secondary") || "#ffffff",
    menuBorder: g("--border-color") || "#e5e7eb",
    menuHover: g("--bg-primary") || "#f9fafb",
    menuText: g("--text-primary") || "#374151",
    menuTextActive: g("--accent") || "#6366f1",
    menuBorderAccent: g("--border-color") || "#e0e7ff",
    accent: g("--accent") || "#f57f17",
    overdue: g("--semantic-overdue") || "#d84315",
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GraphRendererProps {
  graph: Graph | null;
  onNodeToggle: (nodeId: number, collapsed: boolean) => void;
  onNodeEdit?: (nodeId: number) => void;
  onDeleteNode?: (nodeId: number) => void;
  onAddNode?: (parentId: number) => void;
  selectedNodeId?: number | null;
  onNodeSelect?: (nodeId: number | null) => void;
  centerTargetNodeId?: number | null;
}

interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

function computeViewportForNode(
  svgEl: SVGSVGElement,
  nodePos: { x: number; y: number; height: number },
): Viewport {
  const rect = svgEl.getBoundingClientRect();
  // X axis: pin node's left edge to a fixed offset from viewport's left edge.
  // Y axis: vertically center the node.
  return {
    x: VIEWPORT_X_OFFSET - nodePos.x,
    y: rect.height / 2 - (nodePos.y + nodePos.height / 2),
    zoom: 1,
  };
}

// ---------------------------------------------------------------------------
// Helper: compute layout for current graph state
// ---------------------------------------------------------------------------

function truncateText(
  text: string,
  maxWidthPixels: number,
  fontSize: number,
): string {
  // Rough estimate: ~0.6 * fontSize per character for system-ui font
  const maxChars = Math.floor(maxWidthPixels / (fontSize * 0.6));
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1) + "…";
}

function formatDeadline(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const month = d.toLocaleString("en", { month: "short" });
    const day = d.getDate();
    const hour = d.getHours().toString().padStart(2, "0");
    const minute = d.getMinutes().toString().padStart(2, "0");
    return `📅 ${month} ${day} ${hour}:${minute}`;
  } catch {
    return iso;
  }
}

function computeLayout(graph: Graph): {
  graph: Graph;
  nodes: Map<number, { x: number; y: number; height: number }>;
  edges: Array<{ from: number; to: number }>;
  bounds: { width: number; height: number };
} {
  const engine = new LayoutEngine();
  engine.setGraph(graph);
  const result = engine.computeLayout();
  const bounds = getLayoutBounds(result);

  const nodes = new Map<number, { x: number; y: number; height: number }>();
  for (const [id, node] of result.nodes) {
    nodes.set(id, { x: node.x, y: node.y, height: node.height });
  }

  return { graph, nodes, edges: result.edges, bounds };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GraphRenderer({
  graph,
  onNodeToggle,
  onNodeEdit,
  onDeleteNode,
  onAddNode,
  selectedNodeId: externalSelectedNodeId,
  onNodeSelect,
  centerTargetNodeId,
}: GraphRendererProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredNodeId, setHoveredNodeId] = useState<number | null>(null);
  // Use external selectedNodeId if provided, otherwise fall back to internal state
  const [internalSelectedNodeId, setInternalSelectedNodeId] = useState<
    number | null
  >(null);
  const selectedNodeId = externalSelectedNodeId ?? internalSelectedNodeId;
  const setSelectedNodeId = useCallback(
    (id: number | null) => {
      if (externalSelectedNodeId !== undefined) {
        onNodeSelect?.(id);
      } else {
        setInternalSelectedNodeId(id);
      }
    },
    [externalSelectedNodeId, onNodeSelect, setInternalSelectedNodeId],
  );
  // Compute layout once when graph changes
  const layout = useMemo(() => (!graph ? null : computeLayout(graph)), [graph]);

  // Respond to external center request (e.g. from navigation panel)
  useEffect(() => {
    if (centerTargetNodeId != null && svgRef.current && layout) {
      const nodePos = layout.nodes.get(centerTargetNodeId);
      if (nodePos) {
        const svg = svgRef.current;
        setViewport((v) => ({
          ...computeViewportForNode(svg, nodePos),
          zoom: v.zoom, // preserve current zoom level
        }));
      }
    }
  }, [centerTargetNodeId, layout]);

  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [viewportStart, setViewportStart] = useState({ x: 0, y: 0 });
  const [colors, setColors] = useState(readGraphColors);
  const hasCentered = useRef(false);

  // Re-read colors on theme switch via MutationObserver
  useEffect(() => {
    const observer = new MutationObserver(() => setColors(readGraphColors()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  // Center viewport on first root node at first load only
  useEffect(() => {
    if (layout && svgRef.current && !hasCentered.current) {
      hasCentered.current = true;
      const firstRootId = layout.graph.root_ids[0];
      const rootPos = layout.nodes.get(firstRootId);
      if (rootPos && svgRef.current) {
        setViewport(computeViewportForNode(svgRef.current, rootPos));
      }
    }
  }, [layout]);

  // -----------------------------------------------------------------------
  // Keyboard handler — Backspace / Delete triggers delete modal
  //                — + triggers add node, = triggers edit node
  // -----------------------------------------------------------------------

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't interfere with typing in inputs
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") {
        return;
      }

      if (
        (e.key === "Backspace" || e.key === "Delete") &&
        selectedNodeId !== null &&
        onDeleteNode
      ) {
        e.preventDefault();
        onDeleteNode(selectedNodeId);
      }

      // "+" key triggers add node (root when nothing selected, child of selected otherwise)
      if (e.key === "+") {
        if (onAddNode) {
          e.preventDefault();
          onAddNode(selectedNodeId ?? -1);
        }
      } // "=" key triggers edit node (only when node selected)
      else if (e.key === "=" && selectedNodeId !== null && onNodeEdit) {
        e.preventDefault();
        onNodeEdit(selectedNodeId);
      }
    };

    globalThis.addEventListener("keydown", handleKeyDown);
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
  }, [selectedNodeId, onDeleteNode, onAddNode, onNodeEdit]);

  // -----------------------------------------------------------------------
  // Pan handlers
  // -----------------------------------------------------------------------

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setViewportStart({ x: viewport.x, y: viewport.y });
    },
    [viewport],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      setViewport((v) => ({
        ...v,
        x: viewportStart.x + dx,
        y: viewportStart.y + dy,
      }));
    },
    [isDragging, dragStart, viewportStart],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // -----------------------------------------------------------------------
  // Zoom handler
  // -----------------------------------------------------------------------

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    setViewport((v) => {
      const newZoom = Math.min(3, Math.max(0.1, v.zoom * delta));
      const scale = newZoom / v.zoom;
      const x = mouseX - (mouseX - v.x) * scale;
      const y = mouseY - (mouseY - v.y) * scale;
      return { x, y, zoom: newZoom };
    });
  }, []);

  // -----------------------------------------------------------------------
  // Node interaction
  // -----------------------------------------------------------------------

  const handleNodeClick = useCallback(
    (nodeId: number) => {
      if (selectedNodeId === nodeId) {
        setSelectedNodeId(null);
      } else {
        setSelectedNodeId(nodeId);
      }
    },
    [selectedNodeId, setSelectedNodeId],
  );

  const handleNodeDoubleClick = useCallback(
    (nodeId: number) => {
      onNodeEdit?.(nodeId);
    },
    [onNodeEdit],
  );

  const handleCollapseToggle = useCallback(
    (nodeId: number) => {
      const node = graph?.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const newCollapsed = !node.collapsed;
      onNodeToggle(nodeId, newCollapsed);
    },
    [graph, onNodeToggle],
  );

  // -----------------------------------------------------------------------
  // View actions
  // -----------------------------------------------------------------------

  const handleZoomIn = useCallback(() => {
    setViewport((v) => ({ ...v, zoom: Math.min(3, v.zoom * 1.2) }));
  }, []);

  const handleZoomOut = useCallback(() => {
    setViewport((v) => ({ ...v, zoom: Math.max(0.1, v.zoom / 1.2) }));
  }, []);

  const handleResetView = useCallback(() => {
    if (!svgRef.current || !layout) return;

    // Empty graph: center on origin where the instruction text lives
    if (graph?.nodes.length === 0) {
      const rect = svgRef.current.getBoundingClientRect();
      setViewport({ x: rect.width / 2, y: rect.height / 2, zoom: 1 });
      return;
    }

    const targetId = selectedNodeId ?? layout.graph.root_ids[0];
    const targetPos = layout.nodes.get(targetId);
    if (targetPos && svgRef.current) {
      setViewport(computeViewportForNode(svgRef.current, targetPos));
    }
  }, [selectedNodeId, layout, graph]);

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------

  const getNodeStyle = useCallback(
    (node: GraphNode): React.CSSProperties => {
      const isHovered = hoveredNodeId === node.id;
      const isSelected = selectedNodeId === node.id;
      const isImportant = node.important;

      let fill = colors.nodeFill;
      let stroke = colors.nodeStroke;

      if (isSelected) {
        fill = colors.nodeSelected;
        stroke = colors.nodeSelectedStroke;
      } else if (isHovered) {
        fill = colors.nodeHover;
        stroke = colors.nodeHoverStroke;
      }

      if (isImportant && !isSelected && !isHovered) {
        fill = colors.nodeImportant;
        stroke = colors.nodeImportantStroke;
      }

      return {
        fill,
        stroke,
        strokeWidth: isSelected || isHovered ? 2 : 1,
        cursor: "pointer",
      };
    },
    [hoveredNodeId, selectedNodeId, colors],
  );

  if (!graph || !layout) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: colors.bg,
          color: colors.textSubtle,
          fontSize: 16,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ marginBottom: 12, fontSize: 32 }}>📊</div>
          <div>No graph data loaded.</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            Load a YAML file to get started.
          </div>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const { width: graphWidth, height: graphHeight } = layout.bounds;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        background: colors.bg,
        overflow: "hidden",
      }}
    >
      {/* Top toolbar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          padding: "8px 12px",
          background: colors.toolbarBg,
          borderBottom: `1px solid ${colors.toolbarBorder}`,
          gap: 4,
        }}
      >
        {onAddNode && (
          <button
            type="button"
            onClick={() => onAddNode?.(selectedNodeId ?? -1)}
            title="Add node"
            style={{
              padding: "4px 8px",
              fontSize: 13,
              fontFamily: "system-ui, sans-serif",
              background: colors.accent,
              color: "#ffffff",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              transition: "filter 0.2s",
            }}
            onMouseEnter={(
              e,
            ) => (e.currentTarget.style.filter = "brightness(0.85)")}
            onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
          >
            ＋ Add
          </button>
        )}
        {onNodeEdit && (
          <button
            type="button"
            disabled={selectedNodeId === null}
            onClick={() => onNodeEdit(selectedNodeId!)}
            title="Edit node"
            style={{
              padding: "4px 8px",
              fontSize: 13,
              fontFamily: "system-ui, sans-serif",
              background: selectedNodeId !== null
                ? colors.accent
                : "transparent",
              color: selectedNodeId !== null ? "#ffffff" : colors.toolbarText,
              border: "none",
              borderRadius: 4,
              cursor: selectedNodeId !== null ? "pointer" : "default",
              transition: "filter 0.2s",
              opacity: selectedNodeId !== null ? 1 : 0.4,
            }}
            onMouseEnter={selectedNodeId !== null
              ? (e) => (e.currentTarget.style.filter = "brightness(0.85)")
              : undefined}
            onMouseLeave={selectedNodeId !== null
              ? (e) => (e.currentTarget.style.filter = "none")
              : undefined}
          >
            ✎ Edit
          </button>
        )}

        <div
          style={{
            width: 1,
            height: 20,
            background: colors.toolbarBorder,
            margin: "0 4px",
          }}
        />

        {/* Zoom controls */}
        <button
          type="button"
          onClick={handleZoomIn}
          title="Zoom In"
          style={{
            padding: "4px 8px",
            fontSize: 16,
            fontFamily: "system-ui, sans-serif",
            color: colors.toolbarText,
            background: "transparent",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
          }}
          onMouseEnter={(
            e,
          ) => (e.currentTarget.style.background = colors.toolbarHover)}
          onMouseLeave={(
            e,
          ) => (e.currentTarget.style.background = "transparent")}
        >
          +
        </button>
        <span
          style={{
            fontSize: 12,
            color: colors.toolbarText,
            minWidth: 40,
            textAlign: "center",
            userSelect: "none",
          }}
        >
          {Math.round(viewport.zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={handleZoomOut}
          title="Zoom Out"
          style={{
            padding: "4px 8px",
            fontSize: 16,
            fontFamily: "system-ui, sans-serif",
            color: colors.toolbarText,
            background: "transparent",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
          }}
          onMouseEnter={(
            e,
          ) => (e.currentTarget.style.background = colors.toolbarHover)}
          onMouseLeave={(
            e,
          ) => (e.currentTarget.style.background = "transparent")}
        >
          −
        </button>

        <div
          style={{
            width: 1,
            height: 20,
            background: colors.toolbarBorder,
            margin: "0 4px",
          }}
        />

        <span
          style={{
            fontSize: 12,
            color: colors.toolbarText,
            minWidth: 80,
            userSelect: "none",
          }}
        >
          Position: {Math.round(viewport.x)}, {Math.round(viewport.y)}
        </span>

        <div
          style={{
            width: 1,
            height: 20,
            background: colors.toolbarBorder,
            margin: "0 4px",
          }}
        />

        <button
          type="button"
          onClick={handleResetView}
          title="Reset View"
          style={{
            padding: "4px 8px",
            fontSize: 13,
            fontFamily: "system-ui, sans-serif",
            color: colors.toolbarText,
            background: "transparent",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
          }}
          onMouseEnter={(
            e,
          ) => (e.currentTarget.style.background = colors.toolbarHover)}
          onMouseLeave={(
            e,
          ) => (e.currentTarget.style.background = "transparent")}
        >
          Reset
        </button>

        <div style={{ flex: 1 }} />

        {onDeleteNode && (
          <button
            type="button"
            disabled={selectedNodeId === null}
            onClick={() => onDeleteNode(selectedNodeId!)}
            title="Delete node (roots cannot be deleted)"
            style={{
              padding: "4px 8px",
              fontSize: 13,
              fontFamily: "system-ui, sans-serif",
              background: selectedNodeId !== null
                ? colors.overdue
                : "transparent",
              color: selectedNodeId !== null ? "#ffffff" : colors.toolbarText,
              border: "none",
              borderRadius: 4,
              cursor: selectedNodeId !== null ? "pointer" : "default",
              transition: "filter 0.2s",
              opacity: selectedNodeId !== null ? 1 : 0.4,
            }}
            onMouseEnter={selectedNodeId !== null
              ? (e) => (e.currentTarget.style.filter = "brightness(0.85)")
              : undefined}
            onMouseLeave={selectedNodeId !== null
              ? (e) => (e.currentTarget.style.filter = "none")
              : undefined}
          >
            🗑 Delete
          </button>
        )}
      </div>

      {/* SVG canvas */}
      <svg
        ref={svgRef}
        style={{
          width: "100%",
          height: "100%",
          cursor: isDragging ? "grabbing" : "grab",
          touchAction: "none",
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onClick={(e) => {
          if (e.target === svgRef.current) {
            setSelectedNodeId(null);
          }
        }}
      >
        {/* Defs for arrow marker */}
        <defs>
          <marker
            id="arrowhead"
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" fill={colors.edge} />
          </marker>
          <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodOpacity="0.08" />
          </filter>
        </defs>

        {/* Grid pattern */}
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="10" cy="10" r="0.5" fill={colors.grid} />
        </pattern>
        <rect
          x={-graphWidth * 10}
          y={-graphHeight * 10}
          width={graphWidth * 20}
          height={graphHeight * 20}
          fill="url(#grid)"
        />

        {/* Transform group for pan/zoom */}
        <g
          transform={`translate(${viewport.x}, ${viewport.y}) scale(${viewport.zoom})`}
        >
          {/* Empty graph guidance */}
          {graph.nodes.length === 0 && (
            <text
              x="0"
              y="0"
              textAnchor="middle"
              dominantBaseline="middle"
              fill={colors.textSubtle}
              fontSize="14"
              fontFamily="system-ui, sans-serif"
              pointerEvents="none"
            >
              Click "+ Add" or press Shift and '+' to create your first task
            </text>
          )}
          {/* Edges */}
          {layout.edges.map(({ from, to }) => {
            const fromPos = layout.nodes.get(from);
            const toPos = layout.nodes.get(to);
            if (!fromPos || !toPos) return null;

            const x1 = fromPos.x + NODE_WIDTH;
            const y1 = fromPos.y + fromPos.height / 2;
            const x2 = toPos.x;
            const y2 = toPos.y + toPos.height / 2;
            const midX = (x1 + x2) / 2;

            return (
              <path
                key={`edge-${from}-${to}`}
                d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={colors.edge}
                strokeWidth={1.5}
                markerEnd="url(#arrowhead)"
                style={{ transition: "stroke 0.15s" }}
              />
            );
          })}

          {/* Nodes */}
          {[...layout.nodes.entries()].map(([nodeId, nodePos]) => {
            const node = graph.nodes.find((n) => n.id === nodeId);
            if (!node) return null;

            const style = getNodeStyle(node);
            const isCollapsed = node.collapsed ?? true;
            const hasChildren = node.subtask_ids && node.subtask_ids.length > 0;
            const height = nodePos.height;

            // Compute Y positions for each field
            let currentY = 14;
            const nameY = currentY;
            currentY += 20;

            let detailsY: number | null = null;
            if (node.details) {
              detailsY = currentY;
              currentY += 22;
            }

            let deadlineY: number | null = null;
            if (node.deadline) {
              deadlineY = currentY;
            }

            // Collapse button position (bottom-right area)
            const collapseY = Math.max(nameY, height - 24);

            // Truncate details to fit width
            const truncatedDetails = node.details
              ? truncateText(node.details, NODE_WIDTH - 24, 10)
              : null;

            return (
              <g
                key={nodeId}
                transform={`translate(${nodePos.x}, ${nodePos.y})`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleNodeClick(nodeId);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  handleNodeDoubleClick(nodeId);
                }}
                onMouseEnter={() => setHoveredNodeId(nodeId)}
                onMouseLeave={() => setHoveredNodeId(null)}
              >
                {/* Node rectangle */}
                <rect
                  x={0}
                  y={0}
                  width={NODE_WIDTH}
                  height={height}
                  rx={NODE_RADIUS}
                  ry={NODE_RADIUS}
                  style={style}
                  filter="url(#shadow)"
                />

                {/* Collapse indicator */}
                {hasChildren && (
                  <g
                    transform={`translate(${NODE_WIDTH - 16}, ${collapseY})`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCollapseToggle(nodeId);
                    }}
                    style={{
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    <rect
                      x={0}
                      y={0}
                      width={14}
                      height={14}
                      rx={3}
                      fill={colors.collapseIcon}
                      opacity={0.15}
                    />
                    <text
                      x={7}
                      y={10}
                      textAnchor="middle"
                      fontSize={10}
                      fill={colors.collapseIcon}
                      fontWeight={600}
                      pointerEvents="none"
                      style={{ userSelect: "none" }}
                    >
                      {isCollapsed ? "+" : "−"}
                    </text>
                  </g>
                )}

                {/* Node name */}
                <text
                  x={12}
                  y={nameY}
                  dominantBaseline="middle"
                  fontSize={13}
                  fontWeight={600}
                  fill={colors.text}
                  opacity={node.done ? 0.5 : 1}
                  style={{
                    userSelect: "none",
                    pointerEvents: "none",
                    textDecoration: node.done ? "line-through" : "none",
                  }}
                >
                  {truncateText(
                    node.name,
                    NODE_WIDTH - (hasChildren ? 40 : 24),
                    13,
                  )}
                </text>

                {/* Details */}
                {node.details && detailsY !== null && (
                  <text
                    x={12}
                    y={detailsY}
                    dominantBaseline="middle"
                    fontSize={10}
                    fill={colors.textSubtle}
                    opacity={node.done ? 0.5 : 1}
                    style={{
                      userSelect: "none",
                      pointerEvents: "none",
                      textDecoration: node.done ? "line-through" : "none",
                    }}
                  >
                    {truncatedDetails}
                  </text>
                )}

                {/* Deadline */}
                {node.deadline && deadlineY !== null && (
                  <text
                    x={12}
                    y={deadlineY}
                    dominantBaseline="middle"
                    fontSize={10}
                    fill={colors.textSubtle}
                    opacity={node.done ? 0.5 : 1}
                    style={{
                      userSelect: "none",
                      pointerEvents: "none",
                      textDecoration: node.done ? "line-through" : "none",
                    }}
                  >
                    {formatDeadline(node.deadline)}
                  </text>
                )}

                {/* Important indicator */}
                {node.important && (
                  <g transform={`translate(${NODE_WIDTH - 26}, ${nameY - 4})`}>
                    <circle cx={5} cy={5} r={4} fill="#ffb300" opacity={0.8} />
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
