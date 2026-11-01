import { useEffect, useMemo, useState } from "react";
import type { GraphNode } from "../types/graph.ts";
import DatePicker from "./DatePicker.tsx";
import TimeZonePicker from "./TimeZonePicker.tsx";
import {
  formatDateTimeLocal,
  instantToWall,
  parseDateTimeLocal,
  wallToInstant,
} from "./dateMath.ts";

// ---------------------------------------------------------------------------
// Theme colors - read from CSS variables at runtime
// ---------------------------------------------------------------------------

interface ModalColors {
  bg: string;
  surface: string;
  text: string;
  textMuted: string;
  border: string;
  accent: string;
  accentDark: string;
  hover: string;
  backdrop: string;
}

function readModalColors(): ModalColors {
  const cs = getComputedStyle(document.documentElement);
  const g = (v: string) => cs.getPropertyValue(v).trim();
  return {
    bg: g("--bg-primary") || "#fafafa",
    surface: g("--bg-secondary") || "#ffffff",
    text: g("--text-primary") || "#1a1a2e",
    textMuted: g("--text-secondary") || "#6b7280",
    border: g("--border-color") || "#d1d5db",
    accent: g("--accent") || "#6366f1",
    accentDark: g("--accent") || "#4338ca",
    hover: g("--bg-primary") || "#f3f4f6",
    backdrop: g("--backdrop") || "rgba(0,0,0,0.35)",
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EditNodeModalProps {
  node: GraphNode;
  allNodes: GraphNode[];
  onSave: (updated: GraphNode) => void;
  onCancel: () => void;
  isCreate?: boolean;
  /** Zone deadlines render in (stored data stays UTC). */
  displayTimeZone: string;
  displayTimeZoneIsCustom: boolean;
  onDisplayTimeZoneChange: (timeZone: string | null) => void;
}

interface FormState {
  name: string;
  details: string;
  deadline: string; // datetime-local format "YYYY-MM-DDTHH:mm"
  important: boolean;
  done: boolean;
  subtask_ids: number[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * ISO UTC instant -> datetime-local wire value "YYYY-MM-DDTHH:mm", rendered
 * as wall time in the display zone. Empty/invalid input stays empty.
 */
function isoToDisplayLocal(iso: string | undefined, timeZone: string): string {
  if (!iso) return "";
  const wall = instantToWall(iso, timeZone);
  return wall ? formatDateTimeLocal(wall) : "";
}

/**
 * datetime-local wire value (wall time in the display zone) -> ISO UTC
 * instant for storage. Empty/invalid input stays unset.
 */
function displayLocalToIso(
  value: string,
  timeZone: string,
): string | undefined {
  const parts = parseDateTimeLocal(value);
  if (!parts) return undefined;
  return wallToInstant(parts, timeZone) ?? undefined;
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
  isCreate = false,
  displayTimeZone,
  displayTimeZoneIsCustom,
  onDisplayTimeZoneChange,
}: EditNodeModalProps) {
  const [form, setForm] = useState<FormState>({
    name: node.name,
    details: node.details ?? "",
    deadline: isoToDisplayLocal(node.deadline, displayTimeZone),
    important: node.important ?? false,
    done: node.done ?? false,
    subtask_ids: node.subtask_ids ? [...node.subtask_ids] : [],
  });

  // The form holds wall time in `formTimeZone`. When the display zone
  // changes, re-derive the wall string from the same instant (stored data
  // is untouched - only the presentation shifts). Adjusted during render
  // per React's "adjusting state when props change" pattern.
  const [formTimeZone, setFormTimeZone] = useState(displayTimeZone);
  if (formTimeZone !== displayTimeZone) {
    setFormTimeZone(displayTimeZone);
    setForm((f) => {
      const parts = parseDateTimeLocal(f.deadline);
      if (!parts) return f; // no deadline set - nothing to shift
      const iso = wallToInstant(parts, formTimeZone);
      const next = iso ? instantToWall(iso, displayTimeZone) : null;
      return next ? { ...f, deadline: formatDateTimeLocal(next) } : f;
    });
  }

  const [addDropdownOpen, setAddDropdownOpen] = useState(false);

  // Theme-aware colors - re-read on theme switch via MutationObserver
  const [colors, setColors] = useState(readModalColors);

  useEffect(() => {
    const observer = new MutationObserver(() => setColors(readModalColors()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  // Nodes that can be added as subtasks (exclude self and descendants)
  // In create mode, node.id is 0 which doesn't exist in the graph
  const availableToAdd = useMemo(() => {
    if (isCreate) {
      return allNodes;
    }
    const descendants = collectDescendants(node.id, allNodes);
    const excluded = new Set([node.id, ...descendants]);
    return allNodes.filter((n) => !excluded.has(n.id));
  }, [isCreate, node.id, allNodes]);

  // Filter available by those not already a subtask
  const canAdd = useMemo(() => {
    return availableToAdd.filter((n) => !form.subtask_ids.includes(n.id));
  }, [availableToAdd, form.subtask_ids]);

  // Find node name by ID
  const findNode = (id: number) => allNodes.find((n) => n.id === id);

  const handleSave = () => {
    const trimmedName = form.name.trim();
    const updated: GraphNode = {
      ...node,
      name: trimmedName || (isCreate ? "Untitled" : node.name),
      details: form.details.trim() || undefined,
      deadline: displayLocalToIso(form.deadline, displayTimeZone),
      important: form.important,
      done: form.done,
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
    globalThis.addEventListener("click", handler);
    return () => globalThis.removeEventListener("click", handler);
  }, [addDropdownOpen]);

  // Keyboard shortcut: Escape to cancel, Ctrl+Enter to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") handleSave();
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [onCancel]); // eslint-disable-line react-hooks/exhaustive-deps

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    fontSize: 13,
    fontFamily: "system-ui, -apple-system, sans-serif",
    border: `1px solid ${colors.border}`,
    borderRadius: 6,
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
    background: colors.bg,
    color: colors.text,
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: colors.textMuted,
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
          background: colors.surface,
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
              color: colors.text,
            }}
          >
            Ensure Node
          </h2>
          <button
            type="button"
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
              color: colors.textMuted,
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = colors.hover)
            }
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
            onFocus={(e) => (e.currentTarget.style.borderColor = colors.accent)}
            onBlur={(e) => (e.currentTarget.style.borderColor = colors.border)}
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
            onFocus={(e) => (e.currentTarget.style.borderColor = colors.accent)}
            onBlur={(e) => (e.currentTarget.style.borderColor = colors.border)}
          />
        </div>

        {/* Deadline */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Deadline</label>
          <div style={{ display: "flex", gap: 8 }}>
            <DatePicker
              value={form.deadline}
              onChange={(deadline) => setForm((f) => ({ ...f, deadline }))}
              colors={colors}
              timeZone={displayTimeZone}
            />
            <TimeZonePicker
              timeZone={displayTimeZone}
              isCustom={displayTimeZoneIsCustom}
              onChange={onDisplayTimeZoneChange}
              colors={colors}
            />
          </div>
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
            type="button"
            onClick={() => setForm((f) => ({ ...f, important: !f.important }))}
            style={{
              width: 44,
              height: 24,
              borderRadius: 12,
              border: "none",
              cursor: "pointer",
              background: form.important ? colors.accent : colors.border,
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
                background: colors.surface,
                transition: "left 0.2s",
                boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
              }}
            />
          </button>
          <span style={{ fontSize: 13, color: colors.text }}>Important</span>
        </div>

        {/* Done toggle */}
        <div
          style={{
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, done: !f.done }))}
            style={{
              width: 44,
              height: 24,
              borderRadius: 12,
              border: "none",
              cursor: "pointer",
              background: form.done ? "#10b981" : colors.border,
              position: "relative",
              transition: "background 0.2s",
              flexShrink: 0,
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 2,
                left: form.done ? 22 : 2,
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: colors.surface,
                transition: "left 0.2s",
                boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
              }}
            />
          </button>
          <span style={{ fontSize: 13, color: colors.text }}>Done</span>
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
                      background: colors.bg,
                      color: colors.accentDark,
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 500,
                    }}
                  >
                    {sub ? sub.name : `#${sid}`}
                    <button
                      type="button"
                      onClick={() => removeSubtask(sid)}
                      title={`Remove ${sub?.name ?? sid}`}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: colors.accent,
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
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setAddDropdownOpen((o) => !o);
              }}
              style={{
                padding: "6px 10px",
                fontSize: 12,
                fontWeight: 500,
                background: addDropdownOpen ? colors.hover : colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                cursor: "pointer",
                color: colors.text,
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
                  background: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                  maxHeight: 200,
                  overflowY: "auto",
                }}
              >
                {canAdd.map((n) => (
                  <button
                    type="button"
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
                      color: colors.text,
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = colors.hover)
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <span style={{ fontWeight: 500 }}>#{n.id}</span>
                    <span
                      style={{
                        marginLeft: 8,
                        color: colors.textMuted,
                      }}
                    >
                      {n.name}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {canAdd.length === 0 && form.subtask_ids.length === 0 && (
              <div
                style={{
                  fontSize: 11,
                  color: colors.textMuted,
                  marginTop: 4,
                }}
              >
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
          <span style={{ fontSize: 11, color: colors.textMuted }}>
            Ctrl+Enter to save · Esc to cancel
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 500,
                background: colors.surface,
                color: colors.text,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              style={{
                padding: "8px 20px",
                fontSize: 13,
                fontWeight: 500,
                background: colors.accent,
                color: "#ffffff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.filter = "brightness(0.85)")
              }
              onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
