/**
 * DeleteNodeDialog
 *
 * Confirmation modal for node deletion.
 * Uses a checkbox gate: the delete button stays disabled until the user
 * explicitly acknowledges the re-mapping behavior by checking a box.
 *
 * Design principle: simple and elegant — no extra dependencies, just a
 * clean overlay with a clear explanation and an intentional confirmation.
 */

import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Theme colors — read from CSS variables at runtime
// ---------------------------------------------------------------------------

interface ModalColors {
  bg: string;
  surface: string;
  text: string;
  textMuted: string;
  border: string;
  accent: string;
  overdue: string;
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
    overdue: g("--semantic-overdue") || "#dc2626",
    hover: g("--bg-primary") || "#f3f4f6",
    backdrop: g("--backdrop") || "rgba(0,0,0,0.35)",
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeleteNodeDialogProps {
  /** Display name of the node being deleted */
  nodeName: string;
  /** Whether the node has children that will be re-mapped */
  hasChildren: boolean;
  /** Number of parents the node has */
  parentCount: number;
  /** Callback when delete is confirmed */
  onConfirm: () => void;
  /** Callback when dialog is cancelled */
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DeleteNodeDialog({
  nodeName,
  hasChildren,
  parentCount,
  onConfirm,
  onCancel,
}: DeleteNodeDialogProps) {
  const [confirmed, setConfirmed] = useState(false);

  // Theme-aware colors — re-read on theme switch via MutationObserver
  const [colors, setColors] = useState(readModalColors);

  useEffect(() => {
    const observer = new MutationObserver(() => setColors(readModalColors));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  const explanation = hasChildren
    ? `Its children will be re-mapped to all of its ${parentCount > 1 ? "parents" : "parent"} to preserve the graph structure.`
    : "This will permanently remove the node from the graph.";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: colors.backdrop,
        backdropFilter: "blur(2px)",
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: colors.surface,
          borderRadius: 8,
          padding: "24px 28px",
          maxWidth: 420,
          width: "100%",
          boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 16,
          }}
        >
          <span style={{ fontSize: 18, color: colors.overdue }}>🗑</span>
          <span
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: colors.text,
              fontFamily: "system-ui, sans-serif",
            }}
          >
            Delete "{nodeName}"?
          </span>
        </div>

        {/* Body / explanation */}
        <div
          style={{
            fontSize: 13,
            color: colors.textMuted,
            lineHeight: 1.6,
            marginBottom: 20,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          This action is permanent and cannot be undone. {explanation}
        </div>

        {/* Checkbox gate */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            fontFamily: "system-ui, sans-serif",
            color: colors.text,
            marginBottom: 24,
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            style={{
              width: 16,
              height: 16,
              cursor: "pointer",
              accentColor: colors.overdue,
            }}
          />
          I understand that this node will be permanently deleted
        </label>

        {/* Buttons */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
            onClick={onCancel}
            style={{
              padding: "6px 16px",
              fontSize: 13,
              fontWeight: 500,
              fontFamily: "system-ui, sans-serif",
              background: "transparent",
              color: colors.text,
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              cursor: "pointer",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = colors.hover)
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!confirmed}
            style={{
              padding: "6px 16px",
              fontSize: 13,
              fontWeight: 500,
              fontFamily: "system-ui, sans-serif",
              background: confirmed ? colors.overdue : colors.border,
              color: confirmed ? "#ffffff" : colors.textMuted,
              border: "none",
              borderRadius: 4,
              cursor: confirmed ? "pointer" : "not-allowed",
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => {
              if (confirmed) e.currentTarget.style.background = colors.overdue;
            }}
            onMouseLeave={(e) => {
              if (confirmed) e.currentTarget.style.background = colors.overdue;
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
