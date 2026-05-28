/**
 * Tests for useAutoSave hook.
 *
 * What we CAN test in Deno:
 *   - deriveBaseStatus() — pure function that maps supported/enabled/handle
 *     to a SaveStatus. All 8 input combinations covered.
 *
 * What we CANNOT test in Deno (no browser):
 *   - The React hook lifecycle (useEffect, useState, useCallback).
 *     Would need JSDOM + react-testing-library to mount the hook.
 *   - IndexedDB persistence — Deno's test runner lacks a working IndexedDB
 *     backend for object stores with structured clones of FileHandle-like
 *     objects. Tested manually via browser dev tools.
 *   - File System Access API (showSaveFilePicker, showOpenFilePicker) —
 *     browser-only, requires user gesture + secure context.
 *   - Permission flow (queryPermission / requestPermission) — requires
 *     real browser permission prompts.
 *   - Debounce timing behavior — relies on setTimeout inside React callbacks;
 *     can't observe without rendering the component.
 *   - Download fallback — requires document.createElement and
 *     URL.createObjectURL.
 *   - localStorage helpers — work trivially but testing them here just
 *     verifies Deno's localStorage shim, not our logic.
 *
 * Manual testing checklist:
 *   1. Save As writes file and persists handle to IndexedDB.
 *   2. Reload restores handle and resumes auto-save.
 *   3. File Open tracks the opened file for auto-save.
 *   4. CRUD actions trigger debounced writes.
 *   5. "New" clears the handle.
 *   6. Toggle persists to localStorage.
 *   7. Unsupported browsers show disabled toggle + tooltip.
 *   8. Save As falls back to download when showSaveFilePicker is missing.
 */

import { assertEquals } from "@std/assert";
import { deriveBaseStatus } from "../useAutoSave.ts";

// ----- deriveBaseStatus — pure state machine -----
// Tests all 8 combinations of (supported, autoSaveEnabled, hasHandle).

Deno.test("deriveBaseStatus — unsupported when API not available", () => {
  assertEquals(deriveBaseStatus(false, true, true), "unsupported");
});

Deno.test("deriveBaseStatus — disabled when auto-save is off", () => {
  assertEquals(deriveBaseStatus(true, false, true), "disabled");
});

Deno.test("deriveBaseStatus — disabled when no handle tracked", () => {
  assertEquals(deriveBaseStatus(true, true, false), "disabled");
});

Deno.test("deriveBaseStatus — idle when everything is ready", () => {
  assertEquals(deriveBaseStatus(true, true, true), "idle");
});

Deno.test("deriveBaseStatus — unsupported takes priority over enabled=false", () => {
  assertEquals(deriveBaseStatus(false, false, true), "unsupported");
});

Deno.test("deriveBaseStatus — unsupported takes priority over all false", () => {
  assertEquals(deriveBaseStatus(false, false, false), "unsupported");
});

Deno.test("deriveBaseStatus — disabled when enabled=false and no handle", () => {
  assertEquals(deriveBaseStatus(true, false, false), "disabled");
});

Deno.test("deriveBaseStatus — unsupported when enabled=true, handle=false", () => {
  assertEquals(deriveBaseStatus(false, true, false), "unsupported");
});
