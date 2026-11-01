/**
 * Pure date math for the calendar picker.
 *
 * The picker and EditNodeModal speak the datetime-local wire format
 * "YYYY-MM-DDTHH:mm" (the string in the modal's form state). All helpers
 * are component-free so `node --test` can exercise them without a DOM.
 */

export interface DateTimeParts {
  year: number;
  /** 0-based month, matching Date#getMonth. */
  month0: number;
  day: number;
  hour: number;
  minute: number;
}

const DT_LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * Parse a datetime-local value into components, or null.
 *
 * Strict on purpose: the wire format is always zero-padded with no seconds,
 * and impossible calendar dates (2026-02-30) are rejected rather than rolled
 * over by Date normalization.
 */
export function parseDateTimeLocal(value: string): DateTimeParts | null {
  const m = DT_LOCAL_RE.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month0 = Number(m[2]) - 1;
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  if (hour > 23 || minute > 59) return null;
  // Probing through Date catches month/day overflow that the regex alone
  // accepts (2026-02-30, 2026-13-01): normalization must not shift the date.
  const probe = new Date(year, month0, day);
  if (
    probe.getFullYear() !== year ||
    probe.getMonth() !== month0 ||
    probe.getDate() !== day
  ) {
    return null;
  }
  return { year, month0, day, hour, minute };
}

/** Format components back into the zero-padded datetime-local wire format. */
export function formatDateTimeLocal(parts: DateTimeParts): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${parts.year}-${pad(parts.month0 + 1)}-${pad(parts.day)}` +
    `T${pad(parts.hour)}:${pad(parts.minute)}`
  );
}

/**
 * Replace (or reset) the time on a datetime-local value. An empty time lands
 * on midnight; a value without a parseable date is a no-op.
 */
export function mergeTime(value: string, time: string): string {
  const date = parseDateTimeLocal(value);
  if (!date) return "";
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  return formatDateTimeLocal({
    ...date,
    hour: m ? Number(m[1]) : 0,
    minute: m ? Number(m[2]) : 0,
  });
}

// ---------------------------------------------------------------------------
// Month grid
// ---------------------------------------------------------------------------

export interface MonthCell {
  year: number;
  /** 0-based month, matching Date#getMonth. */
  month0: number;
  day: number;
  /** Whether the cell belongs to the month being displayed. */
  inMonth: boolean;
}

/** Number of days in a month (month0 is 0-based). */
export function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

/**
 * Grid cells (Sunday-first) covering whole weeks of the displayed month,
 * including leading cells from the previous month and trailing cells into
 * the next month. Cell dates come from local-time Date normalization, so
 * year rollovers in both directions are handled by construction.
 */
export function monthGridCells(year: number, month0: number): MonthCell[] {
  const lead = new Date(year, month0, 1).getDay();
  const total = lead + daysInMonth(year, month0);
  const trail = (7 - (total % 7)) % 7;
  const cells: MonthCell[] = [];
  for (let i = 0; i < total + trail; i++) {
    const d = new Date(year, month0, 1 - lead + i);
    cells.push({
      year: d.getFullYear(),
      month0: d.getMonth(),
      day: d.getDate(),
      inMonth: d.getMonth() === month0 && d.getFullYear() === year,
    });
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Timezone-aware conversion
//
// The stored deadline is an ISO UTC instant; the picker speaks wall-clock
// components in a display time zone. Offsets come from Intl (full ICU in
// Chromium and Node), so no zone database ships with the app.
// ---------------------------------------------------------------------------

const wallFormatters = new Map<string, Intl.DateTimeFormat>();

function getWallFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = wallFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    wallFormatters.set(timeZone, f);
  }
  return f;
}

function wallParts(instantMs: number, timeZone: string): DateTimeParts {
  const parts = getWallFormatter(timeZone).formatToParts(
    new Date(instantMs),
  ) as Intl.DateTimeFormatPart[];
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month0: get("month") - 1,
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

/** Offset (ms) with wall = instant + offset, evaluated in `timeZone`. */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const w = wallParts(instantMs, timeZone);
  const wallAsUtc = Date.UTC(w.year, w.month0, w.day, w.hour, w.minute);
  return wallAsUtc - Math.floor(instantMs / 60000) * 60000;
}

/**
 * Minutes east of UTC for `timeZone` at `atMs` (default: now), for sorting
 * zone lists west-to-east. Returns 0 for an invalid zone.
 */
export function zoneOffsetMinutes(timeZone: string, atMs?: number): number {
  try {
    return Math.round(zoneOffsetMs(atMs ?? Date.now(), timeZone) / 60000);
  } catch {
    return 0;
  }
}

/**
 * Wall-clock components of an ISO instant, rendered in `timeZone`.
 * Returns null for an invalid instant or zone.
 */
export function instantToWall(
  iso: string,
  timeZone: string,
): DateTimeParts | null {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  try {
    return wallParts(d.getTime(), timeZone);
  } catch {
    return null; // invalid timeZone
  }
}

/**
 * The UTC instant for wall-clock components in `timeZone`.
 *
 * Two offset passes handle zones whose offset differs between the naive
 * reading and the resolved instant (DST). Nonexistent spring-forward wall
 * times snap forward past the gap; ambiguous fall-back times resolve to the
 * first occurrence. Returns null for an invalid zone.
 */
export function wallToInstant(
  p: DateTimeParts,
  timeZone: string,
): string | null {
  try {
    const wallAsUtc = Date.UTC(p.year, p.month0, p.day, p.hour, p.minute);
    let ts = wallAsUtc - zoneOffsetMs(wallAsUtc, timeZone);
    ts = wallAsUtc - zoneOffsetMs(ts, timeZone);
    // Gap/fold check: the candidate must read back as the requested wall.
    const back = wallParts(ts, timeZone);
    if (
      back.year !== p.year ||
      back.month0 !== p.month0 ||
      back.day !== p.day ||
      back.hour !== p.hour ||
      back.minute !== p.minute
    ) {
      // Nonexistent wall time (spring-forward gap): the two surrounding
      // candidates straddle the gap - take the larger one (snap forward).
      const a = wallAsUtc - zoneOffsetMs(ts, timeZone);
      const b = wallAsUtc - zoneOffsetMs(a, timeZone);
      ts = Math.max(a, b);
    }
    return new Date(ts).toISOString();
  } catch {
    return null; // invalid timeZone
  }
}

/**
 * Time-entry sanitizer: digits only (letters and symbols ignored), numeric
 * value clamped to 0..max. Preserves typed leading zeros ("05" stays "05").
 */
export function sanitizeDigits(raw: string, max: number): string {
  const digits = raw.replace(/\D/g, "");
  if (digits === "") return "";
  return Number(digits) > max ? String(max) : digits;
}
