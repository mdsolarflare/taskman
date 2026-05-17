import { useCallback, useEffect, useRef, useState } from "react";
import type { ColorMap, ColorVariable, ThemeId } from "../hooks/useTheme";
import { COLOR_LABELS, COLOR_VARIABLES, THEMES } from "../hooks/useTheme";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ThemeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveCustom: (colors: ColorMap) => void;
  onSwitchTheme: (id: ThemeId | "custom") => void;
  activeTheme: ThemeId | "custom";
  hasCustom: boolean;
  readCurrentColors: () => ColorMap;
}

// ---------------------------------------------------------------------------
// Helper: temporarily apply a theme and read its CSS variable values
// ---------------------------------------------------------------------------

function snapshotThemeColors(id: ThemeId | "custom"): ColorMap {
  const original = document.documentElement.getAttribute("data-theme");
  document.documentElement.setAttribute("data-theme", id);

  // Force a style recalculation
  void document.documentElement.offsetHeight;

  const computed = getComputedStyle(document.documentElement);
  const map: ColorMap = {} as ColorMap;
  for (const v of COLOR_VARIABLES) {
    map[v as ColorVariable] = computed.getPropertyValue(v).trim() || "#000000";
  }

  // Restore original
  if (original) {
    document.documentElement.setAttribute("data-theme", original);
  }

  return map;
}

// ---------------------------------------------------------------------------
// Theme preview card
// ---------------------------------------------------------------------------

function ThemeCard({
  theme,
  isActive,
  onSelect,
}: {
  theme: (typeof THEMES)[number];
  isActive: boolean;
  onSelect: (id: ThemeId) => void;
}) {
  return (
    <button
      onClick={() => onSelect(theme.id)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        fontSize: 13,
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontWeight: isActive ? 600 : 400,
        color: isActive ? "var(--accent)" : "var(--text-primary)",
        background: isActive
          ? "var(--bg-tertiary, transparent)"
          : "transparent",
        border: isActive
          ? "1.5px solid var(--accent)"
          : "1.5px solid transparent",
        borderRadius: 8,
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        transition: "background 0.1s, border-color 0.1s",
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.background = "var(--bg-tertiary, transparent)";
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          e.currentTarget.style.background = "transparent";
        }
      }}
    >
      {/* Color swatch placeholder */}
      <span
        style={{
          display: "inline-block",
          width: 18,
          height: 18,
          borderRadius: 4,
          border: "1px solid var(--border-color)",
          background:
            theme.id === "banana-crisis"
              ? "linear-gradient(135deg, #f57f17, #ff8f00)"
              : theme.id === "manhattan-lagoon"
                ? "linear-gradient(135deg, #1d4ed8, #2e7d32)"
                : theme.id === "brooding-burg"
                  ? "linear-gradient(135deg, #ef6c7a, #e65100)"
                  : theme.id === "carbon-noir"
                    ? "linear-gradient(135deg, #3a3a3a, #b0b0b0)"
                    : "linear-gradient(135deg, #ffffff, #00b0ff)",
          flexShrink: 0,
        }}
      />
      <span>{theme.label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Color input row
// ---------------------------------------------------------------------------

function ColorInput({
  variable,
  label,
  value,
  onChange,
}: {
  variable: ColorVariable;
  label: string;
  value: string;
  onChange: (variable: ColorVariable, value: string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <label
        style={{
          fontSize: 12,
          fontFamily: "system-ui, -apple-system, sans-serif",
          color: "var(--text-secondary)",
          width: 120,
          flexShrink: 0,
          textAlign: "right",
        }}
      >
        {label}
      </label>
      <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
        <input
          type="color"
          value={
            variable === "--backdrop"
              ? "#000000"
              : /^rgba?/.test(value)
                ? "#000000"
                : value
          }
          onChange={(e) => onChange(variable, e.target.value)}
          disabled={variable === "--backdrop"}
          style={{
            width: 32,
            height: 28,
            border: "1px solid var(--border-color)",
            borderRadius: 4,
            padding: 0,
            cursor: variable === "--backdrop" ? "not-allowed" : "pointer",
            background: "transparent",
          }}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(variable, e.target.value)}
          style={{
            width: "100%",
            marginLeft: 6,
            padding: "4px 8px",
            fontSize: 12,
            fontFamily: "monospace",
            border: "1px solid var(--border-color)",
            borderRadius: 4,
            outline: "none",
            boxSizing: "border-box",
            color: "var(--text-primary)",
            background: "var(--bg-primary)",
          }}
          placeholder="#hex or rgba()"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export default function ThemeModal({
  isOpen,
  onClose,
  onSaveCustom,
  onSwitchTheme,
  activeTheme,
  hasCustom,
  readCurrentColors,
}: ThemeModalProps) {
  const [draftColors, setDraftColors] = useState<ColorMap>({} as ColorMap);
  const [showEditor, setShowEditor] = useState(false);

  const onCloseRef = useRef(onClose);
  const onSaveRef = useRef(onSaveCustom);
  const onSwitchRef = useRef(onSwitchTheme);
  const readColorsRef = useRef(readCurrentColors);

  // Keep refs in sync with props
  useEffect(() => {
    onCloseRef.current = onClose;
    onSaveRef.current = onSaveCustom;
    onSwitchRef.current = onSwitchTheme;
    readColorsRef.current = readCurrentColors;
  }, [onClose, onSaveCustom, onSwitchTheme, readCurrentColors]);

  // Load current colors when modal opens
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraftColors(readCurrentColors());
      setShowEditor(false);
    }
  }, [isOpen, readCurrentColors]);

  const handleSelectTheme = useCallback((id: ThemeId) => {
    const colors = snapshotThemeColors(id);
    setDraftColors(colors);
    onSwitchRef.current(id);
  }, []);

  const handleSetDraftColor = useCallback(
    (variable: ColorVariable, value: string) => {
      setDraftColors((prev) => ({ ...prev, [variable]: value }));
    },
    [],
  );

  const handleSave = useCallback(() => {
    onSaveRef.current(draftColors);
    onCloseRef.current();
  }, [draftColors]);

  const handleCancel = useCallback(() => {
    onCloseRef.current();
  }, []);

  const handleEditCurrent = useCallback(() => {
    setDraftColors(readColorsRef.current());
    setShowEditor(true);
  }, []);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 400,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--backdrop, rgba(0,0,0,0.35))",
      }}
      onClick={handleCancel}
    >
      <div
        style={{
          background: "var(--bg-secondary, #ffffff)",
          borderRadius: 12,
          padding: "24px 28px",
          maxWidth: 480,
          width: "92%",
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 16px 48px rgba(0,0,0,0.25)",
          color: "var(--text-primary)",
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
              color: "var(--text-primary)",
            }}
          >
            Theme
          </h2>
          <button
            onClick={handleCancel}
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
              color: "var(--text-secondary)",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "var(--bg-primary)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            ✕
          </button>
        </div>

        {/* Theme selector list */}
        {!showEditor && (
          <>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                marginBottom: 16,
              }}
            >
              {THEMES.map((theme) => (
                <ThemeCard
                  key={theme.id}
                  theme={theme}
                  isActive={activeTheme === theme.id}
                  onSelect={handleSelectTheme}
                />
              ))}

              {/* Custom theme option */}
              <button
                onClick={handleEditCurrent}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 12px",
                  fontSize: 13,
                  fontFamily: "system-ui, -apple-system, sans-serif",
                  fontWeight: activeTheme === "custom" ? 600 : 400,
                  color:
                    activeTheme === "custom"
                      ? "var(--accent)"
                      : "var(--text-primary)",
                  background:
                    activeTheme === "custom"
                      ? "var(--bg-tertiary, transparent)"
                      : "transparent",
                  border:
                    activeTheme === "custom"
                      ? "1.5px solid var(--accent)"
                      : "1.5px solid transparent",
                  borderRadius: 8,
                  cursor: "pointer",
                  textAlign: "left",
                  width: "100%",
                  transition: "background 0.1s, border-color 0.1s",
                }}
                onMouseEnter={(e) => {
                  if (activeTheme !== "custom") {
                    e.currentTarget.style.background =
                      "var(--bg-tertiary, transparent)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeTheme !== "custom") {
                    e.currentTarget.style.background = "transparent";
                  }
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    border: "1px solid var(--border-color)",
                    background: "linear-gradient(135deg, #888, #ccc, #888)",
                    flexShrink: 0,
                  }}
                />
                <span>Custom</span>
                {hasCustom && (
                  <span
                    style={{
                      fontSize: 10,
                      opacity: 0.5,
                      marginLeft: "auto",
                    }}
                  >
                    saved
                  </span>
                )}
              </button>
            </div>

            {/* Footer: close button */}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: 8,
              }}
            >
              <button
                onClick={handleCancel}
                style={{
                  padding: "8px 20px",
                  fontSize: 13,
                  fontWeight: 500,
                  background: "var(--accent)",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Done
              </button>
            </div>
          </>
        )}

        {/* Manual color editor */}
        {showEditor && (
          <>
            <p
              style={{
                fontSize: 12,
                color: "var(--text-secondary)",
                marginBottom: 16,
                lineHeight: 1.5,
              }}
            >
              Adjust the 12 color roles below. Changes preview live. Press{" "}
              <strong>Save</strong> to persist as a custom theme.
            </p>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                marginBottom: 20,
              }}
            >
              {COLOR_VARIABLES.map((variable) => (
                <ColorInput
                  key={variable}
                  variable={variable}
                  label={COLOR_LABELS[variable]}
                  value={draftColors[variable] || "#000000"}
                  onChange={handleSetDraftColor}
                />
              ))}
            </div>

            {/* Footer: save / cancel */}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
              }}
            >
              <button
                onClick={handleCancel}
                style={{
                  padding: "8px 20px",
                  fontSize: 13,
                  fontWeight: 500,
                  background: "var(--bg-primary)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-color)",
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
                  background: "var(--accent)",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Save
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
