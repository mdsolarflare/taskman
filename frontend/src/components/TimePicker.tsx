import { useEffect, useRef, useState } from "react";
import { sanitizeDigits } from "./dateMath.ts";
import { useAnchoredPopover } from "../hooks/useAnchoredPopover.ts";
// ---------------------------------------------------------------------------
// Theme colors - passed down from the modal (already re-read on theme switch)
// ---------------------------------------------------------------------------

interface TimePickerColors {
  bg: string;
  surface: string;
  text: string;
  textMuted: string;
  border: string;
  accent: string;
  hover: string;
}

interface TimePickerProps {
  /** "HH:mm" wire value, or "" while no date is picked. */
  value: string;
  onChange: (time: string) => void;
  colors: TimePickerColors;
  disabled?: boolean;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const ROW_H = 32;

const pad = (n: number) => n.toString().padStart(2, "0");

// ---------------------------------------------------------------------------
// Wheel column
// ---------------------------------------------------------------------------

interface WheelColumnProps {
  values: number[];
  selected: number | null;
  onSelect: (v: number) => void;
  ariaLabel: (v: number) => string;
  colors: TimePickerColors;
  /** Set from the parent when the popover value changes (external sync). */
  listRef: React.RefObject<HTMLDivElement | null>;
  /** Unit name for the stepper aria-labels ("hours" / "minutes"). */
  unit: string;
}

/**
 * A scroll-snap roller: 3 rows visible, native drag/wheel scrolling, click a
 * row to select it. The centered row is highlighted; scrolling live-applies
 * the value under it. Instant programmatic scrolls keep click-selection
 * flicker-free.
 */
function WheelColumn({
  values,
  selected,
  onSelect,
  ariaLabel,
  colors,
  listRef,
  unit,
}: WheelColumnProps) {
  // Native scroll listener: React's delegated onScroll misses non-bubbling
  // scroll events from this scroller (the wheel would never apply values).
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      const idx = Math.round(el.scrollTop / ROW_H);
      const v = values[Math.min(Math.max(idx, 0), values.length - 1)];
      if (v !== selected) onSelect(v);
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [listRef, values, selected, onSelect]);

  // One-time open nudge: a tiny oscillation that says "this scrolls".
  // Skipped for users who prefer reduced motion. (WheelColumn remounts on
  // every popover open, so this runs once per open.)
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(
      [
        { transform: "translateY(0px)" },
        { transform: "translateY(-7px)" },
        { transform: "translateY(4px)" },
        { transform: "translateY(0px)" },
      ],
      { duration: 550, easing: "ease-out" },
    );
  }, [listRef]);

  const canUp = selected !== null && selected > 0;
  const canDown = selected !== null && selected < values.length - 1;

  const chevronStyle = (edge: "top" | "bottom"): React.CSSProperties => ({
    position: "absolute",
    [edge]: 0,
    left: "50%",
    transform: "translateX(-50%)",
    width: 26,
    height: 20,
    padding: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 10,
    lineHeight: 1,
    color: colors.textMuted,
    background: "transparent",
    border: "none",
    cursor: "pointer",
  });

  return (
    <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <div
        ref={listRef}
        style={{
          height: ROW_H * 3,
          overflowY: "auto",
          scrollSnapType: "y mandatory",
          padding: ROW_H + "px 0",
          scrollbarWidth: "none",
          maskImage:
            "linear-gradient(transparent, black 25%, black 75%, transparent)",
          WebkitMaskImage:
            "linear-gradient(transparent, black 25%, black 75%, transparent)",
        }}
      >
        {values.map((v) => {
          const isSelected = selected === v;
          return (
            <button
              type="button"
              key={v}
              aria-label={ariaLabel(v)}
              aria-pressed={isSelected}
              onClick={() => onSelect(v)}
              style={{
                width: "100%",
                height: ROW_H,
                padding: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                fontFamily: "system-ui, -apple-system, sans-serif",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                scrollSnapAlign: "center",
                background: isSelected ? colors.accent : "transparent",
                color: isSelected ? "#ffffff" : colors.text,
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
              {pad(v)}
            </button>
          );
        })}
      </div>

      {/* Selection band: the roller's selection window behind the centered
          row (visual affordance, ignores pointers). */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: ROW_H,
          height: ROW_H,
          left: 0,
          right: 0,
          borderRadius: 6,
          background: `color-mix(in srgb, ${colors.accent} 14%, transparent)`,
          borderTop: `1px solid color-mix(in srgb, ${colors.accent} 55%, transparent)`,
          borderBottom: `1px solid color-mix(in srgb, ${colors.accent} 55%, transparent)`,
          pointerEvents: "none",
        }}
      />

      {/* Chevron steppers: affordance + click-to-step, shown only when
          there is more content in that direction. Up the list = decrease,
          down the list = increase. */}
      {canUp && (
        <button
          type="button"
          aria-label={`Decrease ${unit}`}
          onClick={() => onSelect((selected ?? 0) - 1)}
          style={chevronStyle("top")}
          onMouseEnter={(e) => (e.currentTarget.style.color = colors.text)}
          onMouseLeave={(e) => (e.currentTarget.style.color = colors.textMuted)}
        >
          ▲
        </button>
      )}
      {canDown && (
        <button
          type="button"
          aria-label={`Increase ${unit}`}
          onClick={() => onSelect((selected ?? 0) + 1)}
          style={chevronStyle("bottom")}
          onMouseEnter={(e) => (e.currentTarget.style.color = colors.text)}
          onMouseLeave={(e) => (e.currentTarget.style.color = colors.textMuted)}
        >
          ▼
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Theme-matched time entry: a styled field opening a popover with typeable
 * HH/MM segments (digits only, clamped to valid ranges) above scroll-snap
 * wheel columns. Typed input and wheels stay in sync through the shared
 * "HH:mm" value. Speaks the time half of the datetime-local wire format; the
 * date side is untouched. Picking the minute completes the interaction and
 * closes the popover, mirroring how a day click completes the date picker.
 */
export default function TimePicker({
  value,
  onChange,
  colors,
  disabled = false,
}: TimePickerProps) {
  const {
    open,
    toggle: popToggle,
    close: popClose,
    setAnchorEl,
    setPopoverEl,
    anchor,
  } = useAnchoredPopover();
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  const hour = m ? Number(m[1]) : null;
  const minute = m ? Number(m[2]) : null;

  // Segment text is local while a segment is focused (so typing "9" does not
  // get padded to "09" mid-keystroke); it resyncs from the value otherwise.
  const [hourText, setHourText] = useState(() => value.slice(0, 2));
  const [minuteText, setMinuteText] = useState(() => value.slice(3, 5));
  const hourRef = useRef<HTMLInputElement>(null);
  const minuteRef = useRef<HTMLInputElement>(null);
  const hourListRef = useRef<HTMLDivElement>(null);
  const minuteListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (document.activeElement !== hourRef.current)
      setHourText(value.slice(0, 2));
    if (document.activeElement !== minuteRef.current)
      setMinuteText(value.slice(3, 5));
  }, [value]);

  // Keep the wheels centered on the selected value (external changes too).
  useEffect(() => {
    const hourEl = hourListRef.current;
    if (hourEl) {
      const target = (hour ?? 0) * ROW_H;
      if (Math.abs(hourEl.scrollTop - target) > 1) hourEl.scrollTop = target;
    }
    const minuteEl = minuteListRef.current;
    if (minuteEl) {
      const target = (minute ?? 0) * ROW_H;
      if (Math.abs(minuteEl.scrollTop - target) > 1)
        minuteEl.scrollTop = target;
    }
  }, [value, open, hour, minute]);

  const setHour = (h: number) =>
    onChange(pad(h) + ":" + (minute === null ? "00" : pad(minute)));

  const setMinute = (min: number) => {
    onChange(pad(hour === null ? 0 : hour) + ":" + pad(min));
  };

  const onHourChange = (raw: string) => {
    const t = sanitizeDigits(raw, 23);
    setHourText(t);
    if (t !== "")
      onChange(pad(Number(t)) + ":" + (minute === null ? "00" : pad(minute)));
    if (t.length === 2) minuteRef.current?.focus();
  };

  const onMinuteChange = (raw: string) => {
    const t = sanitizeDigits(raw, 59);
    setMinuteText(t);
    if (t !== "")
      onChange(pad(hour === null ? 0 : hour) + ":" + pad(Number(t)));
  };

  const onSegmentBlur = (
    text: string,
    set: (t: string) => void,
    fallback: string,
  ) => {
    // Empty on blur restores the current value; otherwise pad the digits.
    set(text === "" ? fallback : pad(Number(text)));
  };

  const fieldStyle: React.CSSProperties = {
    width: 96,
    padding: "8px 10px",
    fontSize: 13,
    fontFamily: "system-ui, -apple-system, sans-serif",
    border: "1px solid " + colors.border,
    borderRadius: 6,
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
    background: colors.bg,
    color: colors.text,
    textAlign: "center",
    flexShrink: 0,
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? "default" : "pointer",
  };

  const segmentStyle: React.CSSProperties = {
    width: 40,
    padding: "6px 2px",
    fontSize: 14,
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontVariantNumeric: "tabular-nums",
    border: "1px solid " + colors.border,
    borderRadius: 6,
    outline: "none",
    boxSizing: "border-box",
    background: colors.bg,
    color: colors.text,
    textAlign: "center",
  };

  return (
    <div
      ref={setAnchorEl}
      style={{ position: "relative", flexShrink: 0 }}
      onKeyDown={(e) => {
        // Close the popover without also closing the modal (the modal's
        // own Escape handler listens on window).
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          popClose();
        }
      }}
    >
      {/* Field */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Deadline time"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-disabled={disabled}
        onClick={() => {
          if (!disabled) popToggle();
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            popToggle();
          }
        }}
        style={fieldStyle}
        onFocus={(e) => (e.currentTarget.style.borderColor = colors.accent)}
        onBlur={(e) => (e.currentTarget.style.borderColor = colors.border)}
      >
        {value || "--:--"}
      </div>

      {/* Time entry popover - fixed-anchored to the field so the modal
          card's scroll box can never clip it */}
      {open && anchor && (
        <div
          ref={setPopoverEl}
          role="dialog"
          aria-label="Pick a deadline time"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: anchor.top,
            right: anchor.right,
            maxHeight: anchor.maxBottom - anchor.top,
            overflowY: "auto",
            zIndex: 10,
            width: 250,
            padding: 12,
            background: colors.surface,
            border: "1px solid " + colors.border,
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            userSelect: "none",
          }}
        >
          {/* Typed segments */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              marginBottom: 10,
            }}
          >
            <input
              ref={hourRef}
              type="text"
              inputMode="numeric"
              aria-label="Deadline time hour"
              value={hourText}
              maxLength={2}
              disabled={disabled}
              onChange={(e) => onHourChange(e.target.value)}
              onBlur={() =>
                onSegmentBlur(hourText, setHourText, value.slice(0, 2))
              }
              style={segmentStyle}
            />
            <span
              style={{ color: colors.textMuted, fontWeight: 600, fontSize: 14 }}
            >
              :
            </span>
            <input
              ref={minuteRef}
              type="text"
              inputMode="numeric"
              aria-label="Deadline time minute"
              value={minuteText}
              maxLength={2}
              disabled={disabled}
              onChange={(e) => onMinuteChange(e.target.value)}
              onBlur={() =>
                onSegmentBlur(minuteText, setMinuteText, value.slice(3, 5))
              }
              style={segmentStyle}
            />
          </div>

          {/* Wheel columns */}
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{
                  display: "block",
                  fontSize: 10,
                  fontWeight: 600,
                  color: colors.textMuted,
                  marginBottom: 4,
                  textAlign: "center",
                }}
              >
                Hours
              </span>
              <WheelColumn
                values={HOURS}
                selected={hour}
                onSelect={setHour}
                ariaLabel={(v) => "Hour " + v}
                colors={colors}
                listRef={hourListRef}
                unit="hours"
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{
                  display: "block",
                  fontSize: 10,
                  fontWeight: 600,
                  color: colors.textMuted,
                  marginBottom: 4,
                  textAlign: "center",
                }}
              >
                Minutes
              </span>
              <WheelColumn
                values={MINUTES}
                selected={minute}
                onSelect={setMinute}
                ariaLabel={(v) => "Minute " + v}
                colors={colors}
                listRef={minuteListRef}
                unit="minutes"
              />
            </div>
          </div>

          {/* Wheels apply live; Done (or outside click / Esc) dismisses. */}
          <div
            style={{
              marginTop: 8,
              display: "flex",
              justifyContent: "center",
            }}
          >
            <button
              type="button"
              onClick={popClose}
              style={{
                padding: "4px 12px",
                fontSize: 12,
                fontWeight: 500,
                background: colors.accent,
                color: "#ffffff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontFamily: "system-ui, -apple-system, sans-serif",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.filter = "brightness(0.85)")
              }
              onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
