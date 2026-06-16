import { useCallback, useEffect, useRef, useState } from "react";
import GraphRenderer from "./components/GraphRenderer.tsx";
import EditNodeModal from "./components/EditNodeModal.tsx";
import DeleteNodeDialog from "./components/DeleteNodeDialog.tsx";
import type { Graph, GraphNode } from "./types/graph.ts";
import {
  addNode,
  buildGraphFromYaml,
  deleteNode,
  saveGraphToYaml,
} from "./wasm.ts";
import ThemeModal from "./components/ThemeModal.tsx";
import NavigationPanel from "./components/NavigationPanel.tsx";
import { useTheme } from "./hooks/useTheme.ts";
import { useAutoSave } from "./hooks/useAutoSave.ts";
import "./themes.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = "taskman_workspace";
const SAMPLE_URL = "./sample.yaml";

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

interface AppState {
  graph: Graph | null;
  yaml: string | null;
  loading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function saveWorkspace(yaml: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, yaml);
  } catch {
    // quota exceeded — silently ignore
  }
}

function loadSavedWorkspace(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function App() {
  const [state, setState] = useState<AppState>({
    graph: null,
    yaml: null,
    loading: false,
    error: null,
  });

  const [menuOpen, setMenuOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<number | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [addParentId, setAddParentId] = useState<number>(-1); // -1 = root node
  const [deletingNodeId, setDeletingNodeId] = useState<number | null>(null);
  const [showThemeModal, setShowThemeModal] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [navOpen, setNavOpen] = useState(true);
  const [centerTargetNodeId, setCenterTargetNodeId] = useState<number | null>(
    null,
  );

  const theme = useTheme();

  // Load YAML into a graph via WASM.
  const loadYaml = useCallback(async (yaml: string, isSample?: boolean) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const result = await buildGraphFromYaml(yaml);
      if (result && typeof result === "object" && "nodes" in result) {
        const graph = result as Graph;
        setState({ graph, yaml, loading: false, error: null });
        // Persist workspace (unless it's the sample — user hasn't modified it yet)
        if (!isSample) {
          saveWorkspace(yaml);
        }
      } else {
        setState({
          graph: null,
          yaml: null,
          loading: false,
          error: "Unexpected response from WASM",
        });
      }
    } catch (err) {
      setState({
        graph: null,
        yaml: null,
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }, []);

  // Restore saved workspace on mount (or fall back to sample on first visit).
  // WASM is guaranteed initialized by the time React mounts, so we can call
  // buildGraphFromYaml directly without a ref indirection.
  useEffect(() => {
    const load = async () => {
      const saved = loadSavedWorkspace();
      if (saved) {
        await loadYaml(saved);
      } else {
        try {
          const yaml = await fetch(SAMPLE_URL).then((res) => res.text());
          await loadYaml(yaml, true);
        } catch (err) {
          setState({
            graph: null,
            yaml: null,
            loading: false,
            error: `Failed to load sample: ${
              err instanceof Error ? err.message : "Unknown error"
            }`,
          });
        }
      }
    };
    load();
  }, [loadYaml]);

  // Auto-save timer for debouncing frequent writes.
  const autoSaveTimer = useRef<number | null>(null);
  const autoSave = useAutoSave();

  // Debounced save to localStorage (always active as a safety net)
  useEffect(() => {
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
    }
    autoSaveTimer.current = setTimeout(() => {
      if (state.yaml) {
        saveWorkspace(state.yaml);
      }
    }, 1000) as unknown as number;
    return () => {
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current);
      }
    };
  }, [state.yaml]);

  // Handle node selection from navigation panel (select + center)
  const handleNavNodeSelect = useCallback((nodeId: number) => {
    setSelectedNodeId(nodeId);
    setCenterTargetNodeId(nodeId);
  }, []);

  // Handle node selection from graph view
  const handleGraphNodeSelect = useCallback((nodeId: number | null) => {
    setSelectedNodeId(nodeId);
  }, []);

  const handleNodeToggle = useCallback((nodeId: number, collapsed: boolean) => {
    setState((s) => {
      if (!s.graph) return s;
      const nodes = s.graph.nodes.map((n: GraphNode) =>
        n.id === nodeId ? { ...n, collapsed } : n
      );
      return { ...s, graph: { ...s.graph, nodes } };
    });
  }, []);

  const handleFileOpen = async () => {
    setMenuOpen(false);

    // Try FS Access API first — tracks handle for auto-save
    const text = await autoSave.openFile();
    if (text) {
      await loadYaml(text);
      return;
    }

    // Fallback: legacy file input (no auto-save tracking). Clear any
    // existing handle so we don't accidentally write to a stale file.
    await autoSave.clearHandle();

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".yaml,.yml";
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const fallbackText = await file.text();
      await loadYaml(fallbackText);
    };
    input.click();
  };

  const handleFileNew = async () => {
    setMenuOpen(false);
    // Clear saved workspace on "New"
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* noop */
    }
    await autoSave.clearHandle();
    setState({
      graph: {
        nodes: [],
        adjacency: {},
        reverse_adjacency: {},
        root_ids: [],
      },
      yaml: "nodes: []",
      loading: false,
      error: null,
    });
  };

  const handleLoadSample = async () => {
    setMenuOpen(false);
    try {
      const res = await fetch(SAMPLE_URL);
      const yaml = await res.text();
      // Save sample as workspace so it persists on return visit
      saveWorkspace(yaml);
      await loadYaml(yaml);
    } catch (err) {
      setState({
        graph: null,
        yaml: null,
        loading: false,
        error: `Failed to load sample: ${
          err instanceof Error ? err.message : "Unknown error"
        }`,
      });
    }
  };

  const handleDismissHelp = () => {
    setShowHelp(false);
  };

  const handleNodeEdit = useCallback((nodeId: number) => {
    setEditingNodeId(nodeId);
  }, []);

  const handleNodeAdd = useCallback((parentId: number = -1) => {
    setIsCreating(true);
    setAddParentId(parentId);
    // Use a placeholder node — the actual ID is assigned by WASM on save
    setEditingNodeId(0);
  }, []);

  // Common save-and-update logic for both create and edit paths
  const saveGraphAndUpdate = useCallback(async (newGraph: Graph) => {
    try {
      const yaml = await saveGraphToYaml(newGraph);
      saveWorkspace(yaml);
      // Schedule debounced file write to disk
      autoSave.scheduleSave(yaml);
      setState((s) => ({ ...s, graph: newGraph, yaml }));
    } catch (err) {
      setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : "Failed to save graph",
      }));
    }
    setEditingNodeId(null);
    setIsCreating(false);
    setAddParentId(-1);
  }, [autoSave]);

  const handleNodeSave = useCallback(
    async (updated: GraphNode) => {
      if (!state.graph) return;

      let newGraph: Graph;

      if (isCreating) {
        // Create mode — call addNode via WASM
        const result = (await addNode(
          state.graph,
          addParentId,
          updated.name,
          updated.details ?? "",
          updated.deadline ?? "",
          updated.important ?? false,
          updated.done ?? false,
          updated.subtask_ids ?? [],
        )) as { graph: Graph; new_id: number };
        newGraph = result.graph;
      } else {
        // Edit mode — mutate existing node in place
        newGraph = {
          ...state.graph,
          nodes: state.graph.nodes.map((n: GraphNode) =>
            n.id === updated.id ? updated : n
          ),
        };
      }

      await saveGraphAndUpdate(newGraph);
    },
    [isCreating, state.graph, addParentId, saveGraphAndUpdate],
  );

  const handleNodeCancelEdit = useCallback(() => {
    setEditingNodeId(null);
    setIsCreating(false);
    setAddParentId(-1);
  }, []);

  const handleNodeDeleteRequest = useCallback((nodeId: number) => {
    setDeletingNodeId(nodeId);
  }, []);

  const handleNodeDeleteConfirm = useCallback(async () => {
    if (!state.graph || deletingNodeId === null) return;
    try {
      const newGraph = (await deleteNode(state.graph, deletingNodeId)) as Graph;
      const yaml = await saveGraphToYaml(newGraph);
      saveWorkspace(yaml);
      // Schedule debounced file write to disk
      autoSave.scheduleSave(yaml);
      setState((s) => ({ ...s, graph: newGraph, yaml }));
    } catch (err) {
      setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : "Failed to delete node",
      }));
    }
    setDeletingNodeId(null);
  }, [state.graph, deletingNodeId, autoSave]);

  const handleNodeDeleteCancel = useCallback(() => {
    setDeletingNodeId(null);
  }, []);

  const handleFileSaveAs = async () => {
    setMenuOpen(false);
    if (!state.graph) return;
    try {
      const yaml = await saveGraphToYaml(state.graph);
      // Also persist to localStorage
      saveWorkspace(yaml);
      setState((s) => ({ ...s, yaml }));
      // Hook handles picker, write, IndexedDB persistence, and handle association
      await autoSave.saveAs(yaml);
    } catch (err) {
      setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : "Failed to serialize graph",
      }));
    }
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  /* Shorthand for theme colors */
  const c = theme.currentColors;

  /* MenuItem style - uses theme colors */
  const menuItemStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    width: "100%",
    padding: "7px 12px",
    fontSize: 13,
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: c["--text-primary"],
    background: "transparent",
    border: "none",
    textAlign: "left",
    cursor: "pointer",
    borderRadius: 0,
    transition: "background 0.1s",
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100svh",
        width: "100vw",
        overflow: "hidden",
        background: c["--bg-primary"],
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* ─── Top Bar (Sandwich Menu) ─── */}
      <header
        style={{
          height: 48,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          background: c["--bg-secondary"],
          borderBottom: `1px solid ${c["--border-color"]}`,
          zIndex: 50,
          flexShrink: 0,
          gap: 8,
        }}
      >
        {/* Sandwich menu button */}
        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            title="Menu"
            style={{
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: menuOpen ? c["--bg-primary"] : "transparent",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 18,
              color: c["--text-primary"],
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => {
              if (!menuOpen) {
                e.currentTarget.style.background = c["--bg-primary"];
              }
            }}
            onMouseLeave={(e) => {
              if (!menuOpen) {
                e.currentTarget.style.background = "transparent";
              }
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <line x1="3" y1="5" x2="15" y2="5" />
              <line x1="3" y1="9" x2="15" y2="9" />
              <line x1="3" y1="13" x2="15" y2="13" />
            </svg>
          </button>

          {/* Dropdown menu */}
          {menuOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                zIndex: 100,
                minWidth: 200,
                background: c["--bg-secondary"],
                border: `1px solid ${c["--border-color"]}`,
                borderRadius: 8,
                boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "8px 0",
                  borderBottom: `1px solid ${c["--border-color"]}`,
                }}
              >
                <div
                  style={{
                    padding: "4px 12px 6px",
                    fontSize: 11,
                    fontWeight: 600,
                    color: c["--text-secondary"],
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  File
                </div>
                <button
                  type="button"
                  onClick={handleFileNew}
                  style={menuItemStyle}
                  onMouseEnter={(
                    e,
                  ) => (e.currentTarget.style.background = c["--bg-primary"])}
                  onMouseLeave={(
                    e,
                  ) => (e.currentTarget.style.background = "transparent")}
                >
                  <span
                    style={{
                      marginRight: 10,
                      opacity: 0.6,
                    }}
                  >
                    📄
                  </span>
                  New
                </button>
                <button
                  type="button"
                  onClick={handleFileOpen}
                  style={menuItemStyle}
                  onMouseEnter={(
                    e,
                  ) => (e.currentTarget.style.background = c["--bg-primary"])}
                  onMouseLeave={(
                    e,
                  ) => (e.currentTarget.style.background = "transparent")}
                >
                  <span
                    style={{
                      marginRight: 10,
                      opacity: 0.6,
                    }}
                  >
                    📂
                  </span>
                  Open
                </button>
                <button
                  type="button"
                  onClick={handleFileSaveAs}
                  style={menuItemStyle}
                  onMouseEnter={(
                    e,
                  ) => (e.currentTarget.style.background = c["--bg-primary"])}
                  onMouseLeave={(
                    e,
                  ) => (e.currentTarget.style.background = "transparent")}
                >
                  <span
                    style={{
                      marginRight: 10,
                      opacity: 0.6,
                    }}
                  >
                    💾
                  </span>
                  Save As…
                </button>
              </div>
              <div
                style={{
                  padding: "8px 0",
                  borderBottom: `1px solid ${c["--border-color"]}`,
                }}
              >
                <div
                  style={{
                    padding: "4px 12px 6px",
                    fontSize: 11,
                    fontWeight: 600,
                    color: c["--text-secondary"],
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  Theme
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setShowThemeModal(true);
                  }}
                  style={menuItemStyle}
                  onMouseEnter={(
                    e,
                  ) => (e.currentTarget.style.background = c["--bg-primary"])}
                  onMouseLeave={(
                    e,
                  ) => (e.currentTarget.style.background = "transparent")}
                >
                  <span
                    style={{
                      marginRight: 10,
                      opacity: 0.6,
                    }}
                  >
                    🎨
                  </span>
                  {theme.activeThemeLabel}
                </button>
              </div>
              <div style={{ padding: "8px 0" }}>
                <div
                  style={{
                    padding: "4px 12px 6px",
                    fontSize: 11,
                    fontWeight: 600,
                    color: c["--text-secondary"],
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  Help
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setShowHelp(true);
                  }}
                  style={menuItemStyle}
                  onMouseEnter={(
                    e,
                  ) => (e.currentTarget.style.background = c["--bg-primary"])}
                  onMouseLeave={(
                    e,
                  ) => (e.currentTarget.style.background = "transparent")}
                >
                  <span
                    style={{
                      marginRight: 10,
                      opacity: 0.6,
                    }}
                  >
                    ❓
                  </span>
                  About
                </button>
                <button
                  type="button"
                  onClick={handleLoadSample}
                  style={menuItemStyle}
                  onMouseEnter={(
                    e,
                  ) => (e.currentTarget.style.background = c["--bg-primary"])}
                  onMouseLeave={(
                    e,
                  ) => (e.currentTarget.style.background = "transparent")}
                >
                  <span
                    style={{
                      marginRight: 10,
                      opacity: 0.6,
                    }}
                  >
                    📋
                  </span>
                  Load Sample
                </button>
              </div>
            </div>
          )}
        </div>

        {/* App title */}
        <span
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: c["--text-primary"],
            letterSpacing: -0.3,
          }}
        >
          Taskman
        </span>

        <div
          style={{
            width: 1,
            height: 20,
            background: c["--border-color"],
            margin: "0 4px",
          }}
        />

        {/* File name + node status (left-aligned, fills space) */}
        <span
          style={{
            fontSize: 12,
            color: c["--text-secondary"],
            flex: 1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {state.loading
            ? ("Loading…")
            : state.graph
            ? (autoSave.fileName
              ? `${autoSave.fileName} — ${state.graph.nodes.length} nodes`
              : `${state.graph.nodes.length} nodes (unsaved)`)
            : state.error
            ? (
              <span style={{ color: c["--semantic-overdue"] }}>
                Error: {state.error}
              </span>
            )
            : ("Ready")}
        </span>

        {/* GitHub link */}
        <a
          href="https://github.com/mdsolarflare/taskman"
          target="_blank"
          rel="noopener noreferrer"
          title="View source on GitHub"
          style={{
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
            color: c["--text-primary"],
            textDecoration: "none",
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
                0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
                -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87
                2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59
                .82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18
                1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44
                1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87
                3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01
                2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </a>

        {/* Auto-save status dot + toggle */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            flexShrink: 0,
          }}
        >
          {/* Status indicator dot */}
          <span
            title={autoSave.tooltip}
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: autoSave.saveStatus === "disabled"
                ? c["--border-color"]
                : autoSave.saveStatus === "unsupported" ||
                    autoSave.saveStatus === "error"
                ? c["--semantic-overdue"]
                : c["--text-primary"],
            }}
          />

          {/* Auto-save toggle switch */}
          <button
            type="button"
            title={autoSave.tooltip}
            onClick={() => autoSave.toggleAutoSave()}
            disabled={!autoSave.supported || !autoSave.fileName}
            style={{
              width: 32,
              height: 18,
              display: "flex",
              alignItems: "center",
              padding: "0 2px",
              background: autoSave.supported &&
                  autoSave.autoSaveEnabled &&
                  autoSave.fileName
                ? c["--accent"]
                : c["--border-color"],
              border: "none",
              borderRadius: 9,
              cursor: autoSave.supported && autoSave.fileName
                ? "pointer"
                : "not-allowed",
              transition: "background 0.15s",
              opacity: autoSave.supported && autoSave.fileName ? 1 : 0.4,
            }}
          >
            {/* Toggle knob */}
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: "#fff",
                transition: "transform 0.15s",
                transform: autoSave.autoSaveEnabled
                  ? "translateX(14px)"
                  : "translateX(0)",
              }}
            />
          </button>
        </div>

        {/* Nav panel toggle - right aligned */}
        <button
          type="button"
          onClick={() => setNavOpen((o) => !o)}
          title={navOpen ? "Close Navigation" : "Open Navigation"}
          style={{
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 16,
            color: c["--text-primary"],
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = c["--bg-primary"];
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="1" y="1" width="14" height="14" rx="2" />
            <line x1="9" y1="1" x2="9" y2="15" />
            <line x1="12" y1="5" x2="14" y2="5" />
            <line x1="12" y1="8" x2="14" y2="8" />
            <line x1="12" y1="11" x2="14" y2="11" />
          </svg>
        </button>
      </header>

      {/* ─── Main Content Area (Graph + Navigation) ─── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* Graph Canvas */}
        <main
          style={{
            flex: 1,
            position: "relative",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 0,
          }}
        >
          {state.error
            ? (
              // Error state
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 16,
                  padding: 32,
                  textAlign: "center",
                  maxWidth: 500,
                }}
              >
                <div style={{ fontSize: 48 }}>⚠️</div>
                <h2
                  style={{
                    fontSize: 18,
                    fontWeight: 600,
                    color: c["--text-primary"],
                  }}
                >
                  Something went wrong
                </h2>
                <p
                  style={{
                    fontSize: 14,
                    color: c["--text-secondary"],
                    lineHeight: 1.6,
                  }}
                >
                  {state.error}
                </p>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    flexDirection: "column",
                    width: "100%",
                  }}
                >
                  <button
                    type="button"
                    onClick={handleLoadSample}
                    style={{
                      padding: "10px 20px",
                      fontSize: 14,
                      fontWeight: 500,
                      background: c["--accent"],
                      color: "#ffffff",
                      border: "none",
                      borderRadius: 6,
                      cursor: "pointer",
                      transition: "background 0.2s",
                    }}
                    onMouseEnter={(
                      e,
                    ) => (e.currentTarget.style.filter = "brightness(0.85)")}
                    onMouseLeave={(
                      e,
                    ) => (e.currentTarget.style.filter = "none")}
                  >
                    Try Loading Sample
                  </button>
                  <button
                    type="button"
                    onClick={handleFileOpen}
                    style={{
                      padding: "10px 20px",
                      fontSize: 14,
                      fontWeight: 500,
                      background: c["--bg-primary"],
                      color: c["--text-primary"],
                      border: `1px solid ${c["--border-color"]}`,
                      borderRadius: 6,
                      cursor: "pointer",
                      transition: "background 0.2s",
                    }}
                    onMouseEnter={(
                      e,
                    ) => (e.currentTarget.style.background =
                      c["--border-color"])}
                    onMouseLeave={(
                      e,
                    ) => (e.currentTarget.style.background = c["--bg-primary"])}
                  >
                    Open Your File
                  </button>
                </div>
              </div>
            )
            : state.graph
            ? (
              <GraphRenderer
                graph={state.graph}
                onNodeToggle={handleNodeToggle}
                onNodeEdit={handleNodeEdit}
                onDeleteNode={handleNodeDeleteRequest}
                onAddNode={handleNodeAdd}
                selectedNodeId={selectedNodeId}
                onNodeSelect={handleGraphNodeSelect}
                centerTargetNodeId={centerTargetNodeId}
              />
            )
            : (
              // Briefly shown during initial load before sample/workspace restores
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: c["--text-secondary"],
                  fontSize: 13,
                }}
              >
                Loading...
              </div>
            )}

          {/* Loading overlay */}
          {state.loading && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: c["--backdrop"],
                zIndex: 30,
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    border: `3px solid ${c["--border-color"]}`,
                    borderTopColor: c["--accent"],
                    borderRadius: "50%",
                    animation: "spin 0.8s linear infinite",
                  }}
                />
                <span
                  style={{
                    fontSize: 13,
                    color: c["--text-secondary"],
                  }}
                >
                  Parsing YAML…
                </span>
              </div>
            </div>
          )}
        </main>

        {/* Right Navigation Panel */}
        {state.graph && (
          <NavigationPanel
            graph={state.graph}
            selectedNodeId={selectedNodeId}
            onNodeSelect={handleNavNodeSelect}
            isOpen={navOpen}
            colors={c}
          />
        )}
      </div>

      {/* ─── About / Help Modal ─── */}
      {showHelp && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: c["--backdrop"],
          }}
          onClick={handleDismissHelp}
        >
          <div
            style={{
              background: c["--bg-secondary"],
              borderRadius: 12,
              padding: "28px 32px",
              maxWidth: 420,
              width: "90%",
              boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              style={{
                margin: "0 0 8px",
                fontSize: 20,
                fontWeight: 600,
                color: c["--text-primary"],
              }}
            >
              About Taskman
            </h2>
            <p
              style={{
                margin: "0 0 16px",
                fontSize: 14,
                lineHeight: 1.6,
                color: c["--text-secondary"],
              }}
            >
              A local-first task graph engine built with Rust/WASM. Data is
              parsed by the Rust layer and rendered as an interactive graph in
              your browser.
            </p>
            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
              }}
            >
              <button
                type="button"
                onClick={handleDismissHelp}
                style={{
                  padding: "8px 20px",
                  fontSize: 13,
                  fontWeight: 500,
                  background: c["--accent"],
                  color: "#ffffff",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Edit/Create Node Modal ─── */}
      {editingNodeId !== null && state.graph && (
        <EditNodeModal
          node={isCreating
            ? {
              id: 0,
              name: "",
              details: "",
              deadline: "",
              important: false,
              subtask_ids: [],
            }
            : (state.graph.nodes.find(
              (n: GraphNode) => n.id === editingNodeId,
            ) ?? state.graph.nodes[0])}
          allNodes={state.graph.nodes}
          onSave={handleNodeSave}
          onCancel={handleNodeCancelEdit}
          isCreate={isCreating}
        />
      )}

      {/* ─── Delete Node Dialog ─── */}
      {deletingNodeId !== null && state.graph && (
        <DeleteNodeDialog
          nodeName={state.graph.nodes.find((n: GraphNode) =>
            n.id === deletingNodeId
          )
            ?.name ?? ""}
          hasChildren={(state.graph.nodes.find((n: GraphNode) =>
            n.id === deletingNodeId
          )
            ?.subtask_ids?.length ?? 0) > 0}
          parentCount={state.graph.nodes.find((n: GraphNode) =>
            n.id === deletingNodeId
          )
            ?.parent_ids?.length ?? 0}
          onConfirm={handleNodeDeleteConfirm}
          onCancel={handleNodeDeleteCancel}
        />
      )}

      {/* ─── Theme Modal ─── */}
      <ThemeModal
        isOpen={showThemeModal}
        onClose={() => setShowThemeModal(false)}
        onSaveCustom={theme.saveDraft}
        onSwitchTheme={theme.switchTheme}
        activeTheme={theme.activeTheme}
        hasCustom={theme.hasCustom}
        readCurrentColors={() => theme.currentColors}
      />

      {/* Spinner animation */}
      <style>
        {`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}
      </style>
    </div>
  );
}

export default App;
