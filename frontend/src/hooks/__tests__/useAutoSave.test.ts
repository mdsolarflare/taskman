/**
 * Tests for useAutoSave hook.
 *
 * What we CAN test in Node:
 *   - deriveBaseStatus() — pure function that maps supported/enabled/handle
 *     to a SaveStatus. All 8 input combinations covered.
 *   - deriveAutoSaveDiagnosis() — pure environment cause-analysis mapping
 *     (secure context, picker presence, browser family) to a block reason
 *     + remediation text. All reason branches covered.
 *
 * What we CANNOT test in Node (no browser):
 *   - The React hook lifecycle (useEffect, useState, useCallback).
 *     Would need JSDOM + react-testing-library to mount the hook.
 *   - IndexedDB persistence — Node's test runner lacks a working IndexedDB
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
 *     verifies Node's localStorage shim, not our logic.
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

import {
  deepStrictEqual as assertEquals,
  ok as assert,
} from "node:assert/strict";
import { test } from "node:test";
import { deriveAutoSaveDiagnosis } from "../useAutoSave.ts";
import { deriveBaseStatus } from "../useAutoSave.ts";

// ----- deriveBaseStatus — pure state machine -----
// Tests all 8 combinations of (supported, autoSaveEnabled, hasHandle).

test("deriveBaseStatus — unsupported when API not available", () => {
  assertEquals(deriveBaseStatus(false, true, true), "unsupported");
});

test("deriveBaseStatus — disabled when auto-save is off", () => {
  assertEquals(deriveBaseStatus(true, false, true), "disabled");
});

test("deriveBaseStatus — disabled when no handle tracked", () => {
  assertEquals(deriveBaseStatus(true, true, false), "disabled");
});

test("deriveBaseStatus — idle when everything is ready", () => {
  assertEquals(deriveBaseStatus(true, true, true), "idle");
});

test("deriveBaseStatus — unsupported takes priority over enabled=false", () => {
  assertEquals(deriveBaseStatus(false, false, true), "unsupported");
});

test("deriveBaseStatus — unsupported takes priority over all false", () => {
  assertEquals(deriveBaseStatus(false, false, false), "unsupported");
});

test("deriveBaseStatus — disabled when enabled=false and no handle", () => {
  assertEquals(deriveBaseStatus(true, false, false), "disabled");
});

test("deriveBaseStatus — unsupported when enabled=true, handle=false", () => {
  assertEquals(deriveBaseStatus(false, true, false), "unsupported");
});

// ----- deriveAutoSaveDiagnosis — environment cause analysis -----

test("deriveAutoSaveDiagnosis — pickers present → ok, regardless of context", () => {
  assertEquals(deriveAutoSaveDiagnosis(false, true, false, false).reason, "ok");
  assertEquals(deriveAutoSaveDiagnosis(true, false, true, true).reason, "ok");
  const okDiag = deriveAutoSaveDiagnosis(true, true, true, true);
  assertEquals(okDiag.supported, true);
  assertEquals(okDiag.remediation, "");
});

test("deriveAutoSaveDiagnosis — insecure context when no pickers", () => {
  const d = deriveAutoSaveDiagnosis(false, false, false, true);
  assertEquals(d.reason, "insecure-context");
  assertEquals(d.supported, false);
  assert(d.remediation.includes("secure context"));
});

test("deriveAutoSaveDiagnosis — secure + no pickers + Chromium → flags-or-version", () => {
  const d = deriveAutoSaveDiagnosis(true, false, false, true);
  assertEquals(d.reason, "flags-or-version");
  assert(d.remediation.includes("chrome://flags"));
});

test("deriveAutoSaveDiagnosis — secure + no pickers + non-Chromium → browser-unsupported", () => {
  const d = deriveAutoSaveDiagnosis(true, false, false, false);
  assertEquals(d.reason, "browser-unsupported");
  assert(d.remediation.includes("falls back to a download"));
});

test("deriveAutoSaveDiagnosis — insecure context outranks browser family", () => {
  // Firefox on http:// — insecure-context is the more actionable cause.
  assertEquals(
    deriveAutoSaveDiagnosis(false, false, false, false).reason,
    "insecure-context",
  );
});
