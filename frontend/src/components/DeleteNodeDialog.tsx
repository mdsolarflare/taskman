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

import { useState } from "react";

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

export default function DeleteNodeDialog({
    nodeName,
    hasChildren,
    parentCount,
    onConfirm,
    onCancel,
}: DeleteNodeDialogProps) {
    const [confirmed, setConfirmed] = useState(false);

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
                background: "rgba(0,0,0,0.3)",
                backdropFilter: "blur(2px)",
            }}
            onClick={onCancel}
        >
            <div
                style={{
                    background: "#ffffff",
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
                    <span style={{ fontSize: 18, color: "#dc2626" }}>🗑</span>
                    <span
                        style={{
                            fontSize: 16,
                            fontWeight: 600,
                            color: "#1a1a2e",
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
                        color: "#6b7280",
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
                        color: "#374151",
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
                            accentColor: "#dc2626",
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
                            color: "#374151",
                            border: "1px solid #d1d5db",
                            borderRadius: 4,
                            cursor: "pointer",
                        }}
                        onMouseEnter={(e) =>
                            (e.currentTarget.style.background = "#f3f4f6")
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
                            background: confirmed ? "#dc2626" : "#d1d5db",
                            color: confirmed ? "#ffffff" : "#9ca3af",
                            border: "none",
                            borderRadius: 4,
                            cursor: confirmed ? "pointer" : "not-allowed",
                            transition: "background 0.15s",
                        }}
                        onMouseEnter={(e) => {
                            if (confirmed)
                                e.currentTarget.style.background = "#b91c1c";
                        }}
                        onMouseLeave={(e) => {
                            if (confirmed)
                                e.currentTarget.style.background = "#dc2626";
                        }}
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
}
