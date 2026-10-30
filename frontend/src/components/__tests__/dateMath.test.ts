/**
 * Unit tests for the calendar picker's datetime-local math helpers.
 *
 * The picker and EditNodeModal speak the datetime-local wire format
 * "YYYY-MM-DDTHH:mm" (the string stored in the modal's form state). These
 * helpers are pure so `node --test` can exercise them without a DOM or the
 * WASM engine.
 */
import {
  deepStrictEqual as assertEquals,
  ok as assert,
} from "node:assert/strict";
import { test } from "node:test";

import {
  daysInMonth,
  formatDateTimeLocal,
  mergeTime,
  monthGridCells,
  parseDateTimeLocal,
} from "../dateMath.ts";

// --- parseDateTimeLocal ------------------------------------------------------

test("parseDateTimeLocal parses a valid datetime-local string", () => {
  assertEquals(parseDateTimeLocal("2026-03-05T14:30"), {
    year: 2026,
    month0: 2,
    day: 5,
    hour: 14,
    minute: 30,
  });
});

test("parseDateTimeLocal handles year boundaries", () => {
  assertEquals(parseDateTimeLocal("2026-12-31T23:59"), {
    year: 2026,
    month0: 11,
    day: 31,
    hour: 23,
    minute: 59,
  });
  assertEquals(parseDateTimeLocal("2027-01-01T00:00"), {
    year: 2027,
    month0: 0,
    day: 1,
    hour: 0,
    minute: 0,
  });
});

test("parseDateTimeLocal rejects empty and malformed input", () => {
  assertEquals(parseDateTimeLocal(""), null);
  assertEquals(parseDateTimeLocal("garbage"), null);
  // Unpadded segments: the datetime-local wire format is always padded.
  assertEquals(parseDateTimeLocal("2026-3-5T14:30"), null);
  assertEquals(parseDateTimeLocal("2026-03-05"), null);
  assertEquals(parseDateTimeLocal("2026-03-05T14:30:00"), null);
});

test("parseDateTimeLocal rejects impossible dates and out-of-range times", () => {
  assertEquals(parseDateTimeLocal("2026-02-30T10:00"), null);
  assertEquals(parseDateTimeLocal("2026-13-01T10:00"), null);
  assertEquals(parseDateTimeLocal("2026-00-15T10:00"), null);
  assertEquals(parseDateTimeLocal("2026-03-00T10:00"), null);
  assertEquals(parseDateTimeLocal("2026-03-05T25:00"), null);
  assertEquals(parseDateTimeLocal("2026-03-05T14:99"), null);
});

// --- formatDateTimeLocal -----------------------------------------------------

test("formatDateTimeLocal zero-pads every segment", () => {
  assertEquals(
    formatDateTimeLocal({ year: 2026, month0: 2, day: 5, hour: 4, minute: 5 }),
    "2026-03-05T04:05",
  );
});

test("format ∘ parse round-trips the wire format", () => {
  for (const v of [
    "2026-03-05T14:30",
    "2026-12-31T23:59",
    "2027-01-01T00:00",
  ]) {
    assertEquals(formatDateTimeLocal(parseDateTimeLocal(v)!), v);
  }
});

// --- mergeTime ---------------------------------------------------------------

test("mergeTime replaces the time on an existing value", () => {
  assertEquals(mergeTime("2026-03-05T09:00", "14:30"), "2026-03-05T14:30");
});

test("mergeTime with an empty time lands on midnight", () => {
  assertEquals(mergeTime("2026-03-05T09:00", ""), "2026-03-05T00:00");
});

test("mergeTime without a date is a no-op", () => {
  assertEquals(mergeTime("", "14:30"), "");
});

// --- daysInMonth / monthGridCells ---------------------------------------------

test("daysInMonth covers normal, leap, and non-leap Februaries", () => {
  assertEquals(daysInMonth(2026, 0), 31);
  assertEquals(daysInMonth(2026, 1), 28);
  assertEquals(daysInMonth(2024, 1), 29);
  assertEquals(daysInMonth(2000, 1), 29);
  assertEquals(daysInMonth(1900, 1), 28);
});

test("monthGridCells: a Sunday-starting 4-week month needs no padding", () => {
  // February 2026 starts on a Sunday and has 28 days - exactly 4 weeks.
  const cells = monthGridCells(2026, 1);
  assertEquals(cells.length, 28);
  assert(cells.every((c) => c.inMonth));
  assertEquals(cells[0], { year: 2026, month0: 1, day: 1, inMonth: true });
  assertEquals(cells[27], { year: 2026, month0: 1, day: 28, inMonth: true });
});

test("monthGridCells pads the leading week from the previous month", () => {
  // January 1 2026 is a Thursday -> 4 lead cells from December 2025.
  const cells = monthGridCells(2026, 0);
  assertEquals(cells.length, 35);
  assertEquals(cells.slice(0, 4), [
    { year: 2025, month0: 11, day: 28, inMonth: false },
    { year: 2025, month0: 11, day: 29, inMonth: false },
    { year: 2025, month0: 11, day: 30, inMonth: false },
    { year: 2025, month0: 11, day: 31, inMonth: false },
  ]);
  assertEquals(cells[4], { year: 2026, month0: 0, day: 1, inMonth: true });
});

test("monthGridCells pads the trailing week into the next month", () => {
  // March 2026 starts on a Sunday with 31 days -> cells 0-30 are in-month,
  // cells 31-34 are the trailing April cells.
  const cells = monthGridCells(2026, 2);
  assertEquals(cells.length, 35);
  assertEquals(cells[30], { year: 2026, month0: 2, day: 31, inMonth: true });
  assertEquals(cells[31], { year: 2026, month0: 3, day: 1, inMonth: false });
  assertEquals(cells[34], { year: 2026, month0: 3, day: 4, inMonth: false });
});

test("monthGridCells rolls over year boundaries in both directions", () => {
  // December 2026: 2 lead cells, 31 days, 2 trailing cells into January 2027.
  const dec = monthGridCells(2026, 11);
  assertEquals(dec.length, 35);
  assertEquals(dec[0], { year: 2026, month0: 10, day: 29, inMonth: false });
  assertEquals(dec[34], { year: 2027, month0: 0, day: 2, inMonth: false });
});

test("monthGridCells keeps the leap day inside a leap February", () => {
  // February 2024 (leap) starts on a Thursday: 4 lead + 29 + 2 trail = 35.
  const cells = monthGridCells(2024, 1);
  assertEquals(cells.length, 35);
  assertEquals(
    cells.find((c) => c.inMonth && c.day === 29),
    { year: 2024, month0: 1, day: 29, inMonth: true },
  );
});
