import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Graph, GraphNode } from "../types/graph";
import { LayoutEngine, getLayoutBounds } from "../engine/layout";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NODE_WIDTH = 200;
const NODE_RADIUS = 6;
const PADDING_X = 240;
const PADDING_Y = 80;

// Color scheme
const COLORS = {
    bg: "#fafafa",
    grid: "#e8e8e8",
    nodeFill: "#ffffff",
    nodeStroke: "#d0d0d0",
    nodeHover: "#f0f0ff",
    nodeHoverStroke: "#8888ff",
    nodeSelected: "#eef0ff",
    nodeSelectedStroke: "#6366f1",
    nodeImportant: "#fff8e1",
    nodeImportantStroke: "#ffb300",
    text: "#1a1a2e",
    textSubtle: "#6b7280",
    edge: "#c5cae9",
    edgeActive: "#8888ff",
    collapseIcon: "#6366f1",
    toolbarBg: "#ffffff",
    toolbarBorder: "#e5e7eb",
    toolbarHover: "#f3f4f6",
    toolbarText: "#374151",
    toolbarActive: "#6366f1",
    menuBg: "#ffffff",
    menuBorder: "#e5e7eb",
    menuHover: "#f9fafb",
    menuText: "#374151",
    menuTextActive: "#6366f1",
    menuBorderAccent: "#e0e7ff",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GraphRendererProps {
    graph: Graph | null;
    yaml: string | null;
    onNodeToggle: (nodeId: number, collapsed: boolean) => void;
    onNodeEdit?: (nodeId: number) => void;
    onDeleteNode?: (nodeId: number) => void;
}

interface Viewport {
    x: number;
    y: number;
    zoom: number;
}

// Default viewport that centers the root node in view
function computeRootViewport(svgEl: SVGSVGElement): Viewport {
    const height = svgEl.getBoundingClientRect().height;
    return { x: 35, y: height / 2 - 40, zoom: 1 };
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
    nodes: Map<number, { x: number; y: number; height: number }>;
    edges: Array<{ from: number; to: number }>;
    bounds: { w: number; h: number };
} {
    const engine = new LayoutEngine();
    engine.setGraph(graph);
    const result = engine.computeLayout();
    const bounds = getLayoutBounds(result);

    const nodes = new Map<number, { x: number; y: number; height: number }>();
    for (const [id, node] of result.nodes) {
        nodes.set(id, { x: node.x, y: node.y, height: node.height });
    }

    return { nodes, edges: result.edges, bounds };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GraphRenderer({
    graph,
    yaml,
    onNodeToggle,
    onNodeEdit,
    onDeleteNode,
}: GraphRendererProps) {
    const svgRef = useRef<SVGSVGElement>(null);
    const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
    const [isDragging, setIsDragging] = useState(false);
    const [hoveredNodeId, setHoveredNodeId] = useState<number | null>(null);
    const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [viewportStart, setViewportStart] = useState({ x: 0, y: 0 });

    // Compute layout once when graph changes
    const layout = useMemo(() => {
        if (!graph) return null;
        return computeLayout(graph);
    }, [graph]);

    // Center viewport on root node at first load
    useEffect(() => {
        if (layout && svgRef.current) {
            setViewport(computeRootViewport(svgRef.current));
        }
    }, [layout]);

    // -----------------------------------------------------------------------
    // Keyboard handler — Backspace / Delete triggers delete modal
    // -----------------------------------------------------------------------

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Don't interfere with typing in inputs
            const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
            if (tag === "input" || tag === "textarea" || tag === "select")
                return;

            if (
                (e.key === "Backspace" || e.key === "Delete") &&
                selectedNodeId !== null &&
                onDeleteNode
            ) {
                e.preventDefault();
                onDeleteNode(selectedNodeId);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [selectedNodeId, onDeleteNode]);

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
        [selectedNodeId],
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
        if (svgRef.current) setViewport(computeRootViewport(svgRef.current));
    }, []);

    // -----------------------------------------------------------------------
    // Render helpers
    // -----------------------------------------------------------------------

    const getNodeStyle = useCallback(
        (node: GraphNode): React.CSSProperties => {
            const isHovered = hoveredNodeId === node.id;
            const isSelected = selectedNodeId === node.id;
            const isImportant = node.important;

            let fill = COLORS.nodeFill;
            let stroke = COLORS.nodeStroke;

            if (isSelected) {
                fill = COLORS.nodeSelected;
                stroke = COLORS.nodeSelectedStroke;
            } else if (isHovered) {
                fill = COLORS.nodeHover;
                stroke = COLORS.nodeHoverStroke;
            }

            if (isImportant && !isSelected && !isHovered) {
                fill = COLORS.nodeImportant;
                stroke = COLORS.nodeImportantStroke;
            }

            return {
                fill,
                stroke,
                strokeWidth: isSelected || isHovered ? 2 : 1,
                cursor: "pointer",
            };
        },
        [hoveredNodeId, selectedNodeId],
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
                    background: COLORS.bg,
                    color: COLORS.textSubtle,
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
                background: COLORS.bg,
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
                    background: COLORS.toolbarBg,
                    borderBottom: `1px solid ${COLORS.toolbarBorder}`,
                    gap: 4,
                }}
            >
                {/* Zoom controls */}
                <button
                    onClick={handleZoomIn}
                    title="Zoom In"
                    style={{
                        padding: "4px 8px",
                        fontSize: 16,
                        fontFamily: "system-ui, sans-serif",
                        color: COLORS.toolbarText,
                        background: "transparent",
                        border: "none",
                        borderRadius: 4,
                        cursor: "pointer",
                    }}
                    onMouseEnter={(e) =>
                        (e.currentTarget.style.background = COLORS.toolbarHover)
                    }
                    onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent")
                    }
                >
                    +
                </button>
                <span
                    style={{
                        fontSize: 12,
                        color: COLORS.toolbarText,
                        minWidth: 40,
                        textAlign: "center",
                        userSelect: "none",
                    }}
                >
                    {Math.round(viewport.zoom * 100)}%
                </span>
                <button
                    onClick={handleZoomOut}
                    title="Zoom Out"
                    style={{
                        padding: "4px 8px",
                        fontSize: 16,
                        fontFamily: "system-ui, sans-serif",
                        color: COLORS.toolbarText,
                        background: "transparent",
                        border: "none",
                        borderRadius: 4,
                        cursor: "pointer",
                    }}
                    onMouseEnter={(e) =>
                        (e.currentTarget.style.background = COLORS.toolbarHover)
                    }
                    onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent")
                    }
                >
                    −
                </button>

                <div
                    style={{
                        width: 1,
                        height: 20,
                        background: COLORS.toolbarBorder,
                        margin: "0 4px",
                    }}
                />

                <button
                    onClick={handleResetView}
                    title="Reset View"
                    style={{
                        padding: "4px 8px",
                        fontSize: 13,
                        fontFamily: "system-ui, sans-serif",
                        color: COLORS.toolbarText,
                        background: "transparent",
                        border: "none",
                        borderRadius: 4,
                        cursor: "pointer",
                    }}
                    onMouseEnter={(e) =>
                        (e.currentTarget.style.background = COLORS.toolbarHover)
                    }
                    onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent")
                    }
                >
                    Reset
                </button>

                <div style={{ flex: 1 }} />

                {/* Node count */}
                <span
                    style={{
                        fontSize: 12,
                        color: COLORS.textSubtle,
                        userSelect: "none",
                    }}
                >
                    {graph.nodes.length} nodes
                </span>
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
                        <polygon points="0 0, 8 3, 0 6" fill={COLORS.edge} />
                    </marker>
                    <filter
                        id="shadow"
                        x="-10%"
                        y="-10%"
                        width="120%"
                        height="120%"
                    >
                        <feDropShadow
                            dx="0"
                            dy="1"
                            stdDeviation="2"
                            floodOpacity="0.08"
                        />
                    </filter>
                </defs>

                {/* Grid pattern */}
                <pattern
                    id="grid"
                    width="20"
                    height="20"
                    patternUnits="userSpaceOnUse"
                >
                    <circle cx="10" cy="10" r="0.5" fill={COLORS.grid} />
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
                                stroke={COLORS.edge}
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
                        const hasChildren =
                            node.subtask_ids && node.subtask_ids.length > 0;
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
                            currentY += 18;
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
                                        style={{ cursor: "pointer" }}
                                    >
                                        <rect
                                            x={0}
                                            y={0}
                                            width={14}
                                            height={14}
                                            rx={3}
                                            fill={COLORS.collapseIcon}
                                            opacity={0.15}
                                        />
                                        <text
                                            x={7}
                                            y={10}
                                            textAnchor="middle"
                                            fontSize={10}
                                            fill={COLORS.collapseIcon}
                                            fontWeight={600}
                                            pointerEvents="none"
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
                                    fill={COLORS.text}
                                    style={{
                                        userSelect: "none",
                                        pointerEvents: "none",
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
                                        fill={COLORS.textSubtle}
                                        style={{
                                            userSelect: "none",
                                            pointerEvents: "none",
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
                                        fill={COLORS.textSubtle}
                                        style={{
                                            userSelect: "none",
                                            pointerEvents: "none",
                                        }}
                                    >
                                        {formatDeadline(node.deadline)}
                                    </text>
                                )}

                                {/* Important indicator */}
                                {node.important && (
                                    <g
                                        transform={`translate(${NODE_WIDTH - 26}, ${nameY - 4})`}
                                    >
                                        <circle
                                            cx={5}
                                            cy={5}
                                            r={4}
                                            fill="#ffb300"
                                            opacity={0.8}
                                        />
                                    </g>
                                )}
                            </g>
                        );
                    })}
                </g>
            </svg>

            {/* Bottom status bar */}
            <div
                style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: 28,
                    display: "flex",
                    alignItems: "center",
                    padding: "0 12px",
                    background: COLORS.toolbarBg,
                    borderTop: `1px solid ${COLORS.toolbarBorder}`,
                    fontSize: 12,
                    color: COLORS.textSubtle,
                    gap: 16,
                }}
            >
                <span>Zoom: {Math.round(viewport.zoom * 100)}%</span>
                <span>
                    Position: {Math.round(viewport.x)}, {Math.round(viewport.y)}
                </span>
                {selectedNodeId !== null && (
                    <span
                        style={{
                            color: COLORS.menuTextActive,
                            fontWeight: 500,
                        }}
                    >
                        Selected:{" "}
                        {graph.nodes.find((n) => n.id === selectedNodeId)?.name}
                    </span>
                )}
                {selectedNodeId !== null && onNodeEdit && (
                    <button
                        onClick={() => onNodeEdit(selectedNodeId!)}
                        title="Edit node"
                        style={{
                            padding: "2px 10px",
                            fontSize: 12,
                            fontWeight: 500,
                            fontFamily: "system-ui, sans-serif",
                            background: "#6366f1",
                            color: "#ffffff",
                            border: "none",
                            borderRadius: 4,
                            cursor: "pointer",
                        }}
                        onMouseEnter={(e) =>
                            (e.currentTarget.style.background = "#4f46e5")
                        }
                        onMouseLeave={(e) =>
                            (e.currentTarget.style.background = "#6366f1")
                        }
                    >
                        ✎ Edit
                    </button>
                )}
                {selectedNodeId !== null && onDeleteNode && (
                    <button
                        onClick={() => onDeleteNode(selectedNodeId!)}
                        title="Delete node (roots cannot be deleted)"
                        style={{
                            marginLeft: "auto",
                            padding: "2px 10px",
                            fontSize: 12,
                            fontWeight: 500,
                            fontFamily: "system-ui, sans-serif",
                            background: "#dc2626",
                            color: "#ffffff",
                            border: "none",
                            borderRadius: 4,
                            cursor: "pointer",
                        }}
                        onMouseEnter={(e) =>
                            (e.currentTarget.style.background = "#b91c1c")
                        }
                        onMouseLeave={(e) =>
                            (e.currentTarget.style.background = "#dc2626")
                        }
                    >
                        🗑 Delete
                    </button>
                )}
            </div>
        </div>
    );
}
