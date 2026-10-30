import { useEffect, useState } from "react";
import {
  formatDateTimeLocal,
  mergeTime,
  monthGridCells,
  parseDateTimeLocal,
  type MonthCell,
} from "./dateMath.ts";

// ---------------------------------------------------------------------------
// Theme colors - passed down from the modal (already re-read on theme switch)
// ---------------------------------------------------------------------------

interface PickerColors {
  bg: string;
  surface: string;
  text: string;
  textMuted: string;
  border: string;
  accent: string;
  hover: string;
}

interface DatePickerProps {
  /** datetime-local wire value "YYYY-MM-DDTHH:mm", or "" when unset. */
  value: string;
  onChange: (value: string) => void;
  colors: PickerColors;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const CELL_SIZE = 28;
const CELL_GAP = 2;

/** Shift a { year, month0 } view by whole months, rolling over years. */
function shiftMonth(
  view: { year: number; month0: number },
  delta: number,
): { year: number; month0: number } {
  const m = view.month0 + delta;
  return { year: view.year + Math.floor(m / 12), month0: ((m % 12) + 12) % 12 };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Theme-matched replacement for the native datetime-local picker: a styled
 * field + time input with a popover month grid. Speaks the same
 * "YYYY-MM-DDTHH:mm" wire format as the modal's form state, so the
 * ISO conversion helpers and save path are untouched.
 */
export default function DatePicker({
  value,
  onChange,
  colors,
}: DatePickerProps) {
  const selected = parseDateTimeLocal(value);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const now = new Date();
    return {
      year: selected?.year ?? now.getFullYear(),
      month0: selected?.month0 ?? now.getMonth(),
    };
  });

  const toggle = () => {
    if (!open) {
      // Open on the month that holds the selection (or today).
      const now = new Date();
      setView({
        year: selected?.year ?? now.getFullYear(),
        month0: selected?.month0 ?? now.getMonth(),
      });
    }
    setOpen(!open);
  };

  // Close on outside click (same mechanism as the subtask dropdown).
  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    globalThis.addEventListener("click", handler);
    return () => globalThis.removeEventListener("click", handler);
  }, [open]);

  const pickDay = (cell: MonthCell) => {
    onChange(
      formatDateTimeLocal({
        year: cell.year,
        month0: cell.month0,
        day: cell.day,
        hour: selected?.hour ?? 0,
        minute: selected?.minute ?? 0,
      }),
    );
    setOpen(false);
  };

  const goToday = () => {
    const now = new Date();
    setView({ year: now.getFullYear(), month0: now.getMonth() });
    onChange(
      formatDateTimeLocal({
        year: now.getFullYear(),
        month0: now.getMonth(),
        day: now.getDate(),
        hour: selected?.hour ?? 0,
        minute: selected?.minute ?? 0,
      }),
    );
    setOpen(false);
  };

  const now = new Date();
  const todayY = now.getFullYear();
  const todayM0 = now.getMonth();
  const todayD = now.getDate();
  const cells = open ? monthGridCells(view.year, view.month0) : [];

  const fieldStyle: React.CSSProperties = {
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

  const navButtonStyle: React.CSSProperties = {
    width: 24,
    height: 24,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    background: "transparent",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 1,
  };

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <div
        style={{ position: "relative", flex: 1, minWidth: 0 }}
        onKeyDown={(e) => {
          // Close the popover without also closing the modal (the modal's
          // own Escape handler listens on window).
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      >
        {/* Field */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Deadline date"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggle();
            }
          }}
          style={{
            ...fieldStyle,
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = colors.accent)}
          onBlur={(e) => (e.currentTarget.style.borderColor = colors.border)}
        >
          <span
            style={{
              flex: 1,
              color: selected ? colors.text : colors.textMuted,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {selected ? value.replace("T", " ") : "Set deadline…"}
          </span>
          {selected && (
            <button
              type="button"
              title="Clear deadline"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
                setOpen(false);
              }}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: colors.textMuted,
                fontSize: 14,
                lineHeight: 1,
                padding: 0,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = colors.text)}
              onMouseLeave={(e) =>
                (e.currentTarget.style.color = colors.textMuted)
              }
            >
              ✕
            </button>
          )}
        </div>

        {/* Month grid popover */}
        {open && (
          <div
            role="dialog"
            aria-label="Pick a deadline date"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              zIndex: 10,
              width: 7 * CELL_SIZE + 6 * CELL_GAP + 24,
              padding: 12,
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
              userSelect: "none",
            }}
          >
            {/* Month navigation */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <button
                type="button"
                title="Previous month"
                aria-label="Previous month"
                onClick={() => setView((v) => shiftMonth(v, -1))}
                style={navButtonStyle}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = colors.hover)
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                ‹
              </button>
              <span
                style={{
                  flex: 1,
                  textAlign: "center",
                  fontSize: 13,
                  fontWeight: 600,
                  color: colors.text,
                }}
              >
                {MONTH_NAMES[view.month0]} {view.year}
              </span>
              <button
                type="button"
                title="Next month"
                aria-label="Next month"
                onClick={() => setView((v) => shiftMonth(v, 1))}
                style={navButtonStyle}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = colors.hover)
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                ›
              </button>
            </div>

            {/* Weekday header + day grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(7, ${CELL_SIZE}px)`,
                gap: CELL_GAP,
              }}
            >
              {WEEKDAY_LABELS.map((w) => (
                <span
                  key={w}
                  style={{
                    width: CELL_SIZE,
                    textAlign: "center",
                    fontSize: 10,
                    fontWeight: 600,
                    color: colors.textMuted,
                    lineHeight: "20px",
                  }}
                >
                  {w}
                </span>
              ))}
              {cells.map((cell) => {
                const isSelected =
                  selected !== null &&
                  cell.year === selected.year &&
                  cell.month0 === selected.month0 &&
                  cell.day === selected.day;
                const isToday =
                  cell.year === todayY &&
                  cell.month0 === todayM0 &&
                  cell.day === todayD;
                return (
                  <button
                    type="button"
                    key={`${cell.year}-${cell.month0}-${cell.day}`}
                    aria-label={`${MONTH_NAMES[cell.month0]} ${cell.day}, ${cell.year}`}
                    aria-pressed={isSelected}
                    onClick={() => pickDay(cell)}
                    style={{
                      width: CELL_SIZE,
                      height: CELL_SIZE,
                      padding: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontFamily: "system-ui, -apple-system, sans-serif",
                      borderRadius: 6,
                      border: "none",
                      cursor: "pointer",
                      background: isSelected ? colors.accent : "transparent",
                      color: isSelected
                        ? "#ffffff"
                        : cell.inMonth
                          ? colors.text
                          : colors.textMuted,
                      boxShadow:
                        isToday && !isSelected
                          ? `inset 0 0 0 1px ${colors.accent}`
                          : "none",
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected)
                        e.currentTarget.style.background = colors.hover;
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected)
                        e.currentTarget.style.background = "transparent";
                    }}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>

            {/* Today shortcut */}
            <div
              style={{
                marginTop: 8,
                display: "flex",
                justifyContent: "center",
              }}
            >
              <button
                type="button"
                onClick={goToday}
                style={{
                  padding: "4px 10px",
                  fontSize: 12,
                  fontWeight: 500,
                  background: "transparent",
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  cursor: "pointer",
                  color: colors.text,
                  fontFamily: "system-ui, -apple-system, sans-serif",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = colors.hover)
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                Today
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Time (enabled once a date is picked) */}
      <input
        type="time"
        aria-label="Deadline time"
        value={selected ? value.slice(11) : ""}
        disabled={!selected}
        onChange={(e) => onChange(mergeTime(value, e.target.value))}
        style={{
          ...fieldStyle,
          width: 108,
          flexShrink: 0,
          opacity: selected ? 1 : 0.5,
          cursor: selected ? "text" : "default",
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = colors.accent)}
        onBlur={(e) => (e.currentTarget.style.borderColor = colors.border)}
      />
    </div>
  );
}
