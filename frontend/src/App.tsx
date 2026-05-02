import { useCallback, useEffect, useRef, useState } from "react";
import GraphRenderer from "./components/GraphRenderer";
import EditNodeModal from "./components/EditNodeModal";
import type { Graph, GraphNode } from "./types/graph";
import { buildGraphFromYaml, saveGraphToYaml } from "./wasm";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = "taskman_workspace";
const SAMPLE_URL = "/sample.yaml";

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

  // Stabilize loadYaml across renders so it's safe to call from useEffect
  const loadYamlRef = useRef<
    ((yaml: string, isSample?: boolean) => Promise<void>) | null
  >(null);

  // Restore saved workspace on mount (or fall back to sample on first visit)
  useEffect(() => {
    const saved = loadSavedWorkspace();
    if (saved) {
      loadYamlRef.current?.(saved);
    } else {
      fetch(SAMPLE_URL)
        .then((res) => res.text())
        .then((yaml) => loadYamlRef.current?.(yaml, true))
        .catch((err) =>
          setState({
            graph: null,
            yaml: null,
            loading: false,
            error: `Failed to load sample: ${err instanceof Error ? err.message : "Unknown error"}`,
          }),
        );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadYaml = async (yaml: string, isSample?: boolean) => {
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
  };

  // Expose loadYaml via ref for the mount effect
  useEffect(() => {
    loadYamlRef.current = loadYaml;
  }, [loadYaml]);

  const handleNodeToggle = useCallback((nodeId: number, collapsed: boolean) => {
    setState((s) => {
      if (!s.graph) return s;
      const nodes = s.graph.nodes.map((n) =>
        n.id === nodeId ? { ...n, collapsed } : n,
      );
      return { ...s, graph: { ...s.graph, nodes } };
    });
  }, []);

  const handleFileOpen = async () => {
    setMenuOpen(false);
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".yaml,.yml";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      loadYaml(text);
    };
    input.click();
  };

  const handleFileNew = () => {
    setMenuOpen(false);
    // Clear saved workspace on "New"
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* noop */
    }
    setState({ graph: null, yaml: null, loading: false, error: null });
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
        error: `Failed to load sample: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
    }
  };

  const handleDismissHelp = () => {
    setShowHelp(false);
  };

  const handleNodeEdit = useCallback((nodeId: number) => {
    setEditingNodeId(nodeId);
  }, []);

  const handleNodeSave = useCallback((updated: GraphNode) => {
    setState((s) => {
      if (!s.graph) return s;
      const nodes = s.graph.nodes.map((n) =>
        n.id === updated.id ? updated : n,
      );
      const newGraph = { ...s.graph, nodes };
      // Auto-save to localStorage
      // We regenerate YAML from the mutated graph via WASM
      (async () => {
        try {
          const yaml = await saveGraphToYaml(newGraph);
          saveWorkspace(yaml);
        } catch {
          /* silent — wasm may not handle mid-edit graphs */
        }
      })();
      return { ...s, graph: newGraph, yaml: s.yaml };
    });
    setEditingNodeId(null);
  }, []);

  const handleNodeCancelEdit = useCallback(() => {
    setEditingNodeId(null);
  }, []);

  // Download a YAML string to disk via File System Access API (with fallback)
  const downloadYamlFile = async (yaml: string, suggestedName?: string) => {
    try {
      // Modern browsers: use showSaveFilePicker for native save dialog
      if ("showSaveFilePicker" in window) {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: suggestedName || "tasks.yaml",
          types: [
            {
              description: "YAML File",
              accept: { "text/yaml": [".yaml", ".yml"] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(yaml);
        await writable.close();
      } else {
        // Fallback: create a blob and trigger download via <a> element
        const blob = new Blob([yaml], { type: "text/yaml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = suggestedName || "tasks.yaml";
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      // User likely cancelled the dialog — silently ignore
      if (err instanceof Error && err.name === "AbortError") return;
      console.error("Failed to save file:", err);
    }
  };

  const handleFileSaveAs = async () => {
    setMenuOpen(false);
    if (!state.graph) return;
    try {
      const yaml = await saveGraphToYaml(state.graph);
      // Also persist to localStorage
      saveWorkspace(yaml);
      setState((s) => ({ ...s, yaml }));
      await downloadYamlFile(yaml, undefined);
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

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100svh",
        width: "100vw",
        overflow: "hidden",
        background: "#fafafa",
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
          background: "#ffffff",
          borderBottom: "1px solid #e5e7eb",
          zIndex: 50,
          flexShrink: 0,
          gap: 8,
        }}
      >
        {/* Sandwich menu button */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            title="Menu"
            style={{
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: menuOpen ? "#f3f4f6" : "transparent",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 18,
              color: "#374151",
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => {
              if (!menuOpen) e.currentTarget.style.background = "#f9fafb";
            }}
            onMouseLeave={(e) => {
              if (!menuOpen) e.currentTarget.style.background = "transparent";
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
                background: "#ffffff",
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "8px 0",
                  borderBottom: "1px solid #e5e7eb",
                }}
              >
                <div
                  style={{
                    padding: "4px 12px 6px",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#9ca3af",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  File
                </div>
                <button
                  onClick={handleFileNew}
                  style={menuItemStyle}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "#f9fafb")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <span style={{ marginRight: 10, opacity: 0.6 }}>📄</span>
                  New
                </button>
                <button
                  onClick={handleFileOpen}
                  style={menuItemStyle}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "#f9fafb")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <span style={{ marginRight: 10, opacity: 0.6 }}>📂</span>
                  Open YAML…
                </button>
                <button
                  onClick={handleFileSaveAs}
                  style={menuItemStyle}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "#f9fafb")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <span style={{ marginRight: 10, opacity: 0.6 }}>💾</span>
                  Save As…
                </button>
                <div
                  style={{
                    height: 1,
                    background: "#e5e7eb",
                    margin: "4px 0",
                  }}
                />
                <button
                  onClick={handleLoadSample}
                  style={menuItemStyle}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "#f9fafb")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <span style={{ marginRight: 10, opacity: 0.6 }}>📋</span>
                  Load Sample
                </button>
              </div>
              <div style={{ padding: "8px 0" }}>
                <div
                  style={{
                    padding: "4px 12px 6px",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#9ca3af",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  Help
                </div>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setShowHelp(true);
                  }}
                  style={menuItemStyle}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "#f9fafb")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <span style={{ marginRight: 10, opacity: 0.6 }}>❓</span>
                  About
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
            color: "#1a1a2e",
            letterSpacing: -0.3,
          }}
        >
          Taskman
        </span>

        <div
          style={{
            width: 1,
            height: 20,
            background: "#e5e7eb",
            margin: "0 4px",
          }}
        />

        {/* Status */}
        <span
          style={{
            fontSize: 12,
            color: "#6b7280",
            flex: 1,
          }}
        >
          {state.loading ? (
            "Loading…"
          ) : state.graph ? (
            `${state.graph.nodes.length} nodes loaded`
          ) : state.error ? (
            <span style={{ color: "#ef4444" }}>Error: {state.error}</span>
          ) : (
            "Ready"
          )}
        </span>
      </header>

      {/* ─── Main Graph Canvas ─── */}
      <main
        style={{
          flex: 1,
          position: "relative",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {state.error ? (
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
            <h2 style={{ fontSize: 18, fontWeight: 600, color: "#1a1a2e" }}>
              Something went wrong
            </h2>
            <p style={{ fontSize: 14, color: "#6b7280", lineHeight: 1.6 }}>
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
                onClick={handleLoadSample}
                style={{
                  padding: "10px 20px",
                  fontSize: 14,
                  fontWeight: 500,
                  background: "#6366f1",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  transition: "background 0.2s",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#4f46e5")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "#6366f1")
                }
              >
                Try Loading Sample
              </button>
              <button
                onClick={handleFileOpen}
                style={{
                  padding: "10px 20px",
                  fontSize: 14,
                  fontWeight: 500,
                  background: "#e5e7eb",
                  color: "#374151",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  transition: "background 0.2s",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#d1d5db")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "#e5e7eb")
                }
              >
                Open Your File
              </button>
            </div>
          </div>
        ) : state.graph ? (
          <GraphRenderer
            graph={state.graph}
            yaml={state.yaml}
            onNodeToggle={handleNodeToggle}
            onNodeEdit={handleNodeEdit}
          />
        ) : (
          // Empty state
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              padding: 32,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 64 }}>📊</div>
            <h2 style={{ fontSize: 20, fontWeight: 600, color: "#1a1a2e" }}>
              Welcome to Taskman
            </h2>
            <p
              style={{
                fontSize: 14,
                color: "#6b7280",
                lineHeight: 1.6,
                maxWidth: 380,
              }}
            >
              A local-first task graph engine. Visualize your tasks and their
              dependencies as an interactive graph.
            </p>
            <div
              style={{
                display: "flex",
                gap: 8,
                flexDirection: "column",
                marginTop: 8,
                width: "100%",
                maxWidth: 300,
              }}
            >
              <button
                onClick={handleLoadSample}
                style={{
                  padding: "12px 24px",
                  fontSize: 14,
                  fontWeight: 500,
                  background: "#6366f1",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  transition: "background 0.2s",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#4f46e5")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "#6366f1")
                }
              >
                📋 Load Sample
              </button>
              <button
                onClick={handleFileOpen}
                style={{
                  padding: "12px 24px",
                  fontSize: 14,
                  fontWeight: 500,
                  background: "#ffffff",
                  color: "#374151",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#f9fafb";
                  e.currentTarget.style.borderColor = "#9ca3af";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#ffffff";
                  e.currentTarget.style.borderColor = "#d1d5db";
                }}
              >
                📂 Open YAML File
              </button>
              <button
                onClick={handleFileNew}
                style={{
                  padding: "12px 24px",
                  fontSize: 14,
                  fontWeight: 500,
                  background: "#ffffff",
                  color: "#374151",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#f9fafb";
                  e.currentTarget.style.borderColor = "#9ca3af";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#ffffff";
                  e.currentTarget.style.borderColor = "#d1d5db";
                }}
              >
                📄 Start Fresh
              </button>
            </div>
            <div
              style={{
                marginTop: 16,
                fontSize: 12,
                color: "#9ca3af",
              }}
            >
              <button
                onClick={() => setShowHelp(true)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#6366f1",
                  cursor: "pointer",
                  textDecoration: "underline",
                  fontSize: 12,
                }}
              >
                Learn more
              </button>
            </div>
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
              background: "rgba(250,250,250,0.8)",
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
                  border: "3px solid #e5e7eb",
                  borderTopColor: "#6366f1",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                }}
              />
              <span style={{ fontSize: 13, color: "#6b7280" }}>
                Parsing YAML…
              </span>
            </div>
          </div>
        )}
      </main>

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
            background: "rgba(0,0,0,0.3)",
          }}
          onClick={handleDismissHelp}
        >
          <div
            style={{
              background: "#ffffff",
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
                color: "#1a1a2e",
              }}
            >
              About Taskman
            </h2>
            <p
              style={{
                margin: "0 0 16px",
                fontSize: 14,
                lineHeight: 1.6,
                color: "#6b7280",
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
                onClick={handleDismissHelp}
                style={{
                  padding: "8px 20px",
                  fontSize: 13,
                  fontWeight: 500,
                  background: "#6366f1",
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

      {/* ─── Edit Node Modal ─── */}
      {editingNodeId !== null && state.graph && (
        <EditNodeModal
          node={
            state.graph.nodes.find((n) => n.id === editingNodeId) ??
            state.graph.nodes[0]
          }
          allNodes={state.graph.nodes}
          onSave={handleNodeSave}
          onCancel={handleNodeCancelEdit}
        />
      )}

      {/* Spinner animation */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const menuItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  padding: "7px 12px",
  fontSize: 13,
  fontFamily: "system-ui, -apple-system, sans-serif",
  color: "#374151",
  background: "transparent",
  border: "none",
  textAlign: "left",
  cursor: "pointer",
  borderRadius: 0,
  transition: "background 0.1s",
};

export default App;
