import { useMemo, useState } from "react";
import { browserTimeZone } from "../hooks/useDisplayTimeZone.ts";
import { useAnchoredPopover } from "../hooks/useAnchoredPopover.ts";

// ---------------------------------------------------------------------------
// Theme colors - passed down from the modal (already re-read on theme switch)
// ---------------------------------------------------------------------------

interface TzPickerColors {
  bg: string;
  surface: string;
  text: string;
  textMuted: string;
  border: string;
  accent: string;
  hover: string;
}

interface TimeZonePickerProps {
  /** Active IANA zone (stored preference or browser default). */
  timeZone: string;
  /** True when the user anchored a zone other than the browser default. */
  isCustom: boolean;
  onChange: (timeZone: string | null) => void;
  colors: TzPickerColors;
}

/** City segment of an IANA id: "America/Los_Angeles" -> "Los Angeles". */
function cityLabel(timeZone: string): string {
  const city = timeZone.split("/").pop() ?? timeZone;
  return city.replace(/_/g, " ");
}

/** Current UTC offset of a zone, e.g. "GMT-7" / "GMT+5:30". */
function zoneOffsetLabel(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

/** All IANA zones known to this runtime (Chromium/Node ship the full set). */
function supportedZones(): string[] {
  const intl = Intl as unknown as {
    supportedValuesOf?: (key: string) => string[];
  };
  if (typeof intl.supportedValuesOf === "function") {
    return intl.supportedValuesOf("timeZone");
  }
  return [browserTimeZone(), "UTC"];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * The display-time-zone control: a chip in the deadline row showing the
 * active zone, opening a searchable IANA zone list. The selection is a
 * display preference only - stored deadlines remain UTC instants.
 */
export default function TimeZonePicker({
  timeZone,
  isCustom,
  onChange,
  colors,
}: TimeZonePickerProps) {
  const { open, toggle, close, setAnchorEl, setPopoverEl, anchor } =
    useAnchoredPopover();
  const [query, setQuery] = useState("");

  const zones = useMemo(() => supportedZones(), []);
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (q === "") return zones;
    return zones.filter(
      (z) =>
        z.toLowerCase().includes(q) || cityLabel(z).toLowerCase().includes(q),
    );
  }, [zones, q]);

  const chipStyle: React.CSSProperties = {
    padding: "8px 10px",
    fontSize: 12,
    fontFamily: "system-ui, -apple-system, sans-serif",
    border: `1px solid ${isCustom ? colors.accent : colors.border}`,
    borderRadius: 6,
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
    background: colors.bg,
    color: colors.text,
    textAlign: "center",
    flexShrink: 0,
    cursor: "pointer",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: 110,
  };

  const rowStyle = (active: boolean): React.CSSProperties => ({
    display: "block",
    width: "100%",
    padding: "6px 10px",
    fontSize: 12,
    textAlign: "left",
    background: active ? colors.accent : "transparent",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    color: active ? "#ffffff" : colors.text,
    fontFamily: "system-ui, -apple-system, sans-serif",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  });

  return (
    <div
      ref={setAnchorEl}
      style={{ position: "relative", flexShrink: 0 }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      {/* Chip */}
      <button
        type="button"
        aria-label="Display time zone"
        title={`${timeZone} - deadlines display in this zone`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        style={chipStyle}
        onFocus={(e) => (e.currentTarget.style.borderColor = colors.accent)}
        onBlur={(e) =>
          (e.currentTarget.style.borderColor = isCustom
            ? colors.accent
            : colors.border)
        }
      >
        {cityLabel(timeZone)}
      </button>

      {/* Zone list popover */}
      {open && anchor && (
        <div
          ref={setPopoverEl}
          role="dialog"
          aria-label="Pick a display time zone"
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
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            userSelect: "none",
          }}
        >
          <input
            type="text"
            aria-label="Search time zones"
            placeholder="Search zones…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            style={{
              width: "100%",
              padding: "6px 8px",
              fontSize: 12,
              fontFamily: "system-ui, -apple-system, sans-serif",
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              outline: "none",
              boxSizing: "border-box",
              marginBottom: 8,
              background: colors.bg,
              color: colors.text,
            }}
          />
          <button
            type="button"
            aria-label="Browser default"
            onClick={() => {
              onChange(null);
              close();
            }}
            style={rowStyle(!isCustom)}
            onMouseEnter={(e) => {
              if (isCustom) e.currentTarget.style.background = colors.hover;
            }}
            onMouseLeave={(e) => {
              if (isCustom) e.currentTarget.style.background = "transparent";
            }}
          >
            {isCustom ? "" : "✓ "}
            Browser default ({cityLabel(browserTimeZone())})
          </button>
          {matches.map((z) => {
            const active = z === timeZone;
            return (
              <button
                type="button"
                key={z}
                aria-label={z}
                title={z}
                onClick={() => {
                  onChange(z);
                  close();
                }}
                style={rowStyle(active)}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = colors.hover;
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = "transparent";
                }}
              >
                {active ? "✓ " : ""}
                {cityLabel(z)} · {zoneOffsetLabel(z)}
              </button>
            );
          })}
          {matches.length === 0 && (
            <div
              style={{
                fontSize: 11,
                color: colors.textMuted,
                padding: "6px 2px",
              }}
            >
              No zones match “{query}”
            </div>
          )}
        </div>
      )}
    </div>
  );
}
