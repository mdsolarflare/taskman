import { useEffect, useMemo, useState } from "react";
import type { GraphNode } from "../types/graph";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EditNodeModalProps {
  node: GraphNode;
  allNodes: GraphNode[];
  onSave: (updated: GraphNode) => void;
  onCancel: () => void;
}

interface FormState {
  name: string;
  details: string;
  deadline: string; // datetime-local format "YYYY-MM-DDTHH:mm"
  important: boolean;
  subtask_ids: number[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert ISO 8601 to datetime-local input value "YYYY-MM-DDTHH:mm" */
function isoToDatetimeLocal(iso?: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime()) || !iso.includes("T")) return "";
    const year = d.getUTCFullYear();
    const month = (d.getUTCMonth() + 1).toString().padStart(2, "0");
    const day = d.getUTCDate().toString().padStart(2, "0");
    const hour = d.getUTCHours().toString().padStart(2, "0");
    const minute = d.getUTCMinutes().toString().padStart(2, "0");
    return `${year}-${month}-${day}T${hour}:${minute}`;
  } catch {
    return "";
  }
}

/** Convert datetime-local value back to ISO 8601 UTC string */
function datetimeLocalToIso(value: string): string | undefined {
  if (!value) return undefined;
  try {
    const d = new Date(`${value}:00Z`);
    if (isNaN(d.getTime())) return undefined;
    return d.toISOString();
  } catch {
    return undefined;
  }
}

/** Collect all descendant IDs of a node (recursive) to prevent cycles */
function collectDescendants(nodeId: number, nodes: GraphNode[]): Set<number> {
  const desc = new Set<number>();
  const stack = [...(nodes.find((n) => n.id === nodeId)?.subtask_ids ?? [])];

  while (stack.length > 0) {
    const childId = stack.pop()!;
    if (!desc.has(childId)) {
      desc.add(childId);
      const child = nodes.find((n) => n.id === childId);
      if (child?.subtask_ids) {
        for (const grandChild of child.subtask_ids) {
          if (!desc.has(grandChild)) stack.push(grandChild);
        }
      }
    }
  }
  return desc;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function EditNodeModal({
  node,
  allNodes,
  onSave,
  onCancel,
}: EditNodeModalProps) {
  const [form, setForm] = useState<FormState>({
    name: node.name,
    details: node.details ?? "",
    deadline: isoToDatetimeLocal(node.deadline),
    important: node.important ?? false,
    subtask_ids: node.subtask_ids ? [...node.subtask_ids] : [],
  });

  const [addDropdownOpen, setAddDropdownOpen] = useState(false);

  // Reset form when the edited node changes
  useEffect(() => {
    setForm({
      name: node.name,
      details: node.details ?? "",
      deadline: isoToDatetimeLocal(node.deadline),
      important: node.important ?? false,
      subtask_ids: node.subtask_ids ? [...node.subtask_ids] : [],
    });
  }, [node.id, node.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // Nodes that can be added as subtasks (exclude self and descendants)
  const availableToAdd = useMemo(() => {
    const descendants = collectDescendants(node.id, allNodes);
    const excluded = new Set([node.id, ...descendants]);
    return allNodes.filter((n) => !excluded.has(n.id));
  }, [node.id, allNodes]);

  // Filter available by those not already a subtask
  const canAdd = useMemo(() => {
    return availableToAdd.filter((n) => !form.subtask_ids.includes(n.id));
  }, [availableToAdd, form.subtask_ids]);

  // Find node name by ID
  const findNode = (id: number) => allNodes.find((n) => n.id === id);

  const handleSave = () => {
    const updated: GraphNode = {
      ...node,
      name: form.name.trim() || node.name, // keep original if emptied
      details: form.details.trim() || undefined,
      deadline: datetimeLocalToIso(form.deadline),
      important: form.important,
      subtask_ids:
        form.subtask_ids.length > 0 ? [...form.subtask_ids] : undefined,
    };
    onSave(updated);
  };

  const removeSubtask = (id: number) => {
    setForm((f) => ({
      ...f,
      subtask_ids: f.subtask_ids.filter((sid) => sid !== id),
    }));
  };

  const addSubtask = (id: number) => {
    if (!form.subtask_ids.includes(id)) {
      setForm((f) => ({
        ...f,
        subtask_ids: [...f.subtask_ids, id],
      }));
    }
    setAddDropdownOpen(false);
  };

  // Close dropdown on outside click
  useEffect(() => {
    if (!addDropdownOpen) return;
    const handler = () => setAddDropdownOpen(false);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [addDropdownOpen]);

  // Keyboard shortcut: Escape to cancel, Ctrl+Enter to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") handleSave();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]); // eslint-disable-line react-hooks/exhaustive-deps

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    fontSize: 13,
    fontFamily: "system-ui, -apple-system, sans-serif",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: "#6b7280",
    marginBottom: 4,
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.35)",
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: 12,
          padding: "24px 28px",
          maxWidth: 460,
          width: "92%",
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "0 16px 48px rgba(0,0,0,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 20,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 600,
              color: "#1a1a2e",
            }}
          >
            Edit Node #{node.id}
          </h2>
          <button
            onClick={onCancel}
            title="Close"
            style={{
              width: 28,
              height: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 16,
              color: "#9ca3af",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#f3f4f6")}
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            ✕
          </button>
        </div>

        {/* Name */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Name</label>
          <input
            type="text"
            value={form.name}
            maxLength={128}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            style={inputStyle}
            onFocus={(e) => (e.currentTarget.style.borderColor = "#6366f1")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "#d1d5db")}
          />
        </div>

        {/* Details */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Details</label>
          <textarea
            value={form.details}
            maxLength={1024}
            rows={3}
            onChange={(e) =>
              setForm((f) => ({ ...f, details: e.target.value }))
            }
            style={{ ...inputStyle, resize: "vertical" }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "#6366f1")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "#d1d5db")}
          />
        </div>

        {/* Deadline */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Deadline</label>
          <input
            type="datetime-local"
            value={form.deadline}
            onChange={(e) =>
              setForm((f) => ({ ...f, deadline: e.target.value }))
            }
            style={{
              ...inputStyle,
              colorScheme: "light",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "#6366f1")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "#d1d5db")}
          />
        </div>

        {/* Important toggle */}
        <div
          style={{
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <button
            onClick={() => setForm((f) => ({ ...f, important: !f.important }))}
            style={{
              width: 44,
              height: 24,
              borderRadius: 12,
              border: "none",
              cursor: "pointer",
              background: form.important ? "#6366f1" : "#d1d5db",
              position: "relative",
              transition: "background 0.2s",
              flexShrink: 0,
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 2,
                left: form.important ? 22 : 2,
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: "#ffffff",
                transition: "left 0.2s",
                boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
              }}
            />
          </button>
          <span style={{ fontSize: 13, color: "#374151" }}>Important</span>
        </div>

        {/* Subtasks */}
        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Subtasks</label>

          {/* Current chips */}
          {form.subtask_ids.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginBottom: 8,
              }}
            >
              {form.subtask_ids.map((sid) => {
                const sub = findNode(sid);
                return (
                  <span
                    key={sid}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "3px 8px",
                      background: "#eef0ff",
                      color: "#4338ca",
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 500,
                    }}
                  >
                    {sub ? sub.name : `#${sid}`}
                    <button
                      onClick={() => removeSubtask(sid)}
                      title={`Remove ${sub?.name ?? sid}`}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "#6366f1",
                        fontSize: 14,
                        lineHeight: 1,
                        padding: 0,
                        marginLeft: 2,
                      }}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          {/* Add dropdown */}
          <div style={{ position: "relative" }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setAddDropdownOpen((o) => !o);
              }}
              style={{
                padding: "6px 10px",
                fontSize: 12,
                fontWeight: 500,
                background: addDropdownOpen ? "#f3f4f6" : "#ffffff",
                border: "1px solid #d1d5db",
                borderRadius: 6,
                cursor: "pointer",
                color: "#374151",
              }}
            >
              + Add subtask
            </button>

            {addDropdownOpen && canAdd.length > 0 && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  zIndex: 10,
                  minWidth: 240,
                  maxWidth: 320,
                  background: "#ffffff",
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                  maxHeight: 200,
                  overflowY: "auto",
                }}
              >
                {canAdd.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => addSubtask(n.id)}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "7px 12px",
                      fontSize: 13,
                      textAlign: "left",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: "#374151",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "#f9fafb")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <span style={{ fontWeight: 500 }}>#{n.id}</span>
                    <span style={{ marginLeft: 8, color: "#6b7280" }}>
                      {n.name}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {canAdd.length === 0 && form.subtask_ids.length === 0 && (
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
                No available nodes to add as subtasks
              </div>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 11, color: "#9ca3af" }}>
            Ctrl+Enter to save · Esc to cancel
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onCancel}
              style={{
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 500,
                background: "#ffffff",
                color: "#374151",
                border: "1px solid #d1d5db",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
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
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "#4f46e5")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "#6366f1")
              }
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
