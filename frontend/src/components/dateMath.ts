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
