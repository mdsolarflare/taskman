/**
 * E2E Test Suite - CDP-driven tests against the live app
 *
 * Reliable because: fresh instance per test, waits on DOM state, no simulated
 * environments, no test frameworks beyond node:test.
 *
 * Environment overrides:
 *   E2E_PUBLIC     - root dir to serve (default: <this-file>/../public)
 *   E2E_CHROME_WS  - WebSocket URL of an existing browser to reuse
 */

import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import {
  deepStrictEqual as assertEquals,
  ok as assert,
} from "node:assert/strict";
import { test } from "node:test";
import { CdpSession, openBrowserPage } from "./cdp.ts";
import { serveStaticDir } from "./serve.ts";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Convert a URL pathname (MSYS-style) to a Windows-native absolute path. */
function toWindowsPath(p: string): string {
  // /c/Users/x/... → C:\Users\x\...   (MSYS/git-bash form)
  const m = p.match(/^\/([c-z])\/(.*)/i);
  if (m) return `${m[1].toUpperCase()}:${m[2].replace(/\//g, "\\")}`;
  // /C:/Users/x/... → C:\Users\x\...  (file:// URL pathname form - the
  // leading slash is an artifact of URL.pathname, not a real path segment)
  const w = p.match(/^\/([a-z]):\/(.*)/i);
  if (w) return `${w[1].toUpperCase()}:\\${w[2].replace(/\//g, "\\")}`;
  return p;
}

const PUBLIC =
  process.env.E2E_PUBLIC ??
  toWindowsPath(new URL("../public/", import.meta.url).pathname);

/** buildId from the build's cache-manifest.js - the SW cache name embeds it. */
function cacheManifestBuildId(): string {
  const src = readFileSync(`${PUBLIC}\\dist\\cache-manifest.js`, "utf8");
  const m = src.match(/self\.CACHE_MANIFEST = (\{[\s\S]*?\});/);
  if (!m) throw new Error("cache-manifest.js has no CACHE_MANIFEST object");
  return (JSON.parse(m[1]) as { buildId: string }).buildId;
}

/**
 * The buildId stamped into the SW main script. Chromium only byte-compares
 * the MAIN sw.js on its update check - if this stamp is missing or stale,
 * a changed shell never triggers an update and installed apps serve the
 * old build forever (the bug this assertion guards against).
 */
function stampedSwBuildId(): string {
  const src = readFileSync(`${PUBLIC}\\sw.js`, "utf8");
  const m = src.match(/const BUILD_ID =\s*"([0-9a-f]{64})"/);
  if (!m) {
    throw new Error(
      "sw.js has no stamped BUILD_ID - run `pnpm run build` (gen-revision stamps it)",
    );
  }
  return m[1];
}

// ---------------------------------------------------------------------------
// Test harness: one browser, fresh tab per test, auto-launch if needed
// ---------------------------------------------------------------------------

interface TestSession {
  conn: CdpSession;
  close: () => Promise<void>;
  /** Simulate network loss: every subsequent server request fails. */
  goOffline: () => void;
}

async function startTestSession(): Promise<TestSession> {
  const server = serveStaticDir(PUBLIC);
  let browserWs =
    process.env.E2E_CHROME_WS ?? (await tryGetExistingDebugger(9222));

  if (!browserWs) {
    const launchedPort = await launchEdgeHeadless();
    browserWs = await tryGetExistingDebugger(launchedPort);
    if (!browserWs) {
      await server.close();
      throw new Error(`Edge debug port ${launchedPort} never came up`);
    }
  }

  const { conn, close } = await openBrowserPage(browserWs, server.url);
  return {
    conn,
    close: async () => {
      await close();
      await server.close();
      // If we spawned our own Edge we leave it running - the profile dir is
      // trade-off for 0-dependency test isolation (reuse is safe).
    },
    goOffline: () => server.goOffline(),
  };
}

async function waitForApp(
  conn: CdpSession,
  opts: { wasmReady?: boolean } = {},
): Promise<void> {
  // Wait for the app to paint its own root (React mounted)
  await conn.waitForFunction(
    "document.querySelector('#root')?.children.length > 0",
    10000,
  );
  // Wait for WASM-side graph parse to land (svg children present)
  if (opts.wasmReady) {
    await conn.waitForFunction(
      "document.querySelectorAll('svg > g').length > 0",
      15000,
    );
  }
}

// ---------------------------------------------------------------------------
// Browser plumbing: CDP discovery + auto-launch
// ---------------------------------------------------------------------------

async function tryGetExistingDebugger(
  port: number = 9222,
): Promise<string | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (!res.ok) return null;
    const info = await res.json();
    return info.webSocketDebuggerUrl as string;
  } catch {
    return null;
  }
}

async function launchEdgeHeadless(): Promise<number> {
  const port = 9222;
  // We do NOT pass 'about:blank'. Passing a URL makes Edge enter '--dump-dom'
  // behavior (single-page exit: the debug port vanishes).
  const stamp = Date.now();
  const localAppData =
    process.env.LOCALAPPDATA ??
    `C:\\Users\\${process.env.USERNAME}\\AppData\\Local`;
  const profileDir = `${localAppData}\\taskman-e2e-edge-${stamp}`;

  // Pipe stderr so we can capture the log for diagnostics if launch fails.
  const proc = spawn(
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      "--headless=new",
      "--no-first-run",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  // Edge is intentionally left running after the tests (profile-dir reuse
  // trade-off), but a Node child handle with a piped stderr holds the
  // event loop open - the runner would hang after reporting results.
  // unref() lets Node exit while data events still flow during the poll.
  proc.unref();
  proc.stderr!.unref();

  // Drain stderr chunks so the pipe never fills and blocks Edge.
  const stderrChunks: string[] = [];
  const dec = new TextDecoder();
  proc.stderr!.on("data", (c: Buffer) => {
    stderrChunks.push(dec.decode(c));
  });

  // Edge's first-run init on Windows can take 10-15s; poll generously.
  const maxTries = 75; // 75 * 400ms = 30s
  for (let i = 0; i < maxTries; i++) {
    await new Promise((r) => setTimeout(r, 400));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        // Small grace period after the debug URL is readable before cancel.
        await new Promise((r) => setTimeout(r, 200));
        return port;
      }
    } catch {
      /* keep trying */
    }
  }
  proc.kill();
  throw new Error(
    `Edge did not start debugging on port ${port} after ${maxTries * 400}ms\n` +
      `Edge stderr:\n${
        stderrChunks.join("").slice(-2000) || "(no Edge stderr output captured)"
      }`,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("app boots, WASM ready, sample graph renders", async () => {
  const { conn, close } = await startTestSession();
  try {
    await waitForApp(conn, { wasmReady: true });

    // Auto-save environment guard: the e2e origin (http://127.0.0.1:<port>)
    // must expose the File System Access API pickers - localhost-class
    // origins are secure contexts. If this ever fails, serving changed in a
    // way that broke the secure context and auto-save is silently dead.
    const fsaOk = (await conn.evaluate(
      "typeof showSaveFilePicker === 'function' && isSecureContext",
    )) as boolean;
    assert(
      fsaOk,
      "File System Access API unavailable at the e2e origin - " +
        "auto-save would be broken by an insecure serving context",
    );

    const nodeCount = (await conn.evaluate(
      "document.querySelectorAll('svg > g').length",
    )) as number;
    assert(nodeCount > 0, "no <g> elements in the SVG - no graph rendered");

    const wasmAvailable = (await conn.evaluate(
      "(async () => { const r = await fetch('./dist/ichor_bg.wasm', {method: 'HEAD'}); return r.ok; })()",
    )) as boolean;
    assert(wasmAvailable, "WASM binary not present at ./dist/ichor_bg.wasm");
  } finally {
    await close();
  }
});

test("sample graph persisted to localStorage matches the source file", async () => {
  const { conn, close } = await startTestSession();
  try {
    await waitForApp(conn, { wasmReady: true });

    const sampleFetch = (await conn.evaluate(
      "fetch('./sample.yaml').then(r => r.text())",
    )) as string;

    // App persists the workspace to localStorage on a 1-second debounce -
    // wait until the key shows up (up to 3s), then compare.
    let fromStorage: string | null = null;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      fromStorage = (await conn.evaluate(
        "localStorage.getItem('taskman_workspace')",
      )) as string | null;
      if (fromStorage !== null) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    assertEquals(
      fromStorage,
      sampleFetch,
      "localStorage workspace does not match /sample.yaml for a first-time visit",
    );
  } finally {
    await close();
  }
});

test("service worker registers, precaches the shell, and serves offline", async () => {
  const { conn, close, goOffline } = await startTestSession();
  try {
    await waitForApp(conn, { wasmReady: true });

    // Wait for the SW to be active AND controlling the page. `ready`
    // resolves on activation, but control only transfers after
    // clients.claim() lands - poll for the controller instead of a
    // single-shot check (races on first install).
    const controlled = (await conn.evaluate(
      "(async () => { " +
        "  await navigator.serviceWorker.ready; " +
        "  for (let i = 0; i < 100; i++) { " +
        "    if (navigator.serviceWorker.controller) return true; " +
        "    await new Promise((r) => setTimeout(r, 100)); " +
        "  } " +
        "  return false; " +
        "})()",
    )) as boolean;
    assert(controlled, "page is not controlled by an active service worker");

    // The cache name embeds the buildId the app was built with.
    const buildId = cacheManifestBuildId();
    // Build integrity: the stamped sw.js buildId must equal the manifest's.
    // Chromium's update check byte-compares only the MAIN sw.js, so a
    // stale/missing stamp means shell updates silently never happen.
    assertEquals(
      stampedSwBuildId(),
      buildId,
      "sw.js stamped BUILD_ID does not match dist/cache-manifest.js - shell updates are broken; run `pnpm run build`",
    );
    const cacheKeys = (await conn.evaluate(
      "(async () => { " +
        "  await navigator.serviceWorker.ready; " +
        "  return (await caches.keys()).sort(); " +
        "})()",
    )) as string[];
    assert(
      cacheKeys.includes(`taskman-shell-${buildId}`),
      `expected cache 'taskman-shell-${buildId}', got: ${JSON.stringify(
        cacheKeys,
      )}`,
    );

    // Precache completeness: every manifest file plus the app URL ('./')
    // must be cached, so the first run after install works offline.
    const cachedPaths = (await conn.evaluate(
      "(async () => { " +
        `  const c = await caches.open('taskman-shell-${buildId}'); ` +
        "  const keys = await c.keys(); " +
        "  return keys.map((r) => new URL(r.url).pathname).sort(); " +
        "})()",
    )) as string[];
    assert(
      cachedPaths.length >= 12,
      `expected >=12 precached entries, got ${cachedPaths.length}: ${JSON.stringify(
        cachedPaths,
      )}`,
    );

    // Offline: cut the server, reload, and the app must still boot from the
    // service worker cache (React mounts + graph renders).
    goOffline();
    await conn.evaluate("location.reload()");
    await waitForApp(conn, { wasmReady: true });
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Custom theme - regression: saving the editor used to persist the default
// palette (not the typed colors), because the commit path read a stale
// hook-side draft instead of the modal's draft it was handed.
// ---------------------------------------------------------------------------

test("custom theme: editor colors are applied, persisted, and survive reload", async () => {
  const { conn, close } = await startTestSession();
  try {
    await waitForApp(conn, { wasmReady: true });

    // Start from clean theme state - a port collision with an earlier run
    // could otherwise leave stale theme keys behind.
    await conn.evaluate("localStorage.clear()");
    await conn.evaluate("location.reload()");
    await waitForApp(conn, { wasmReady: true });

    // Menu → Theme modal
    await conn.evaluate(
      `document.querySelector('button[title="Menu"]').click()`,
    );
    await conn.evaluate(
      `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('🎨')).click()`,
    );
    await conn.waitForFunction(
      `!![...document.querySelectorAll('h2')].find((h) => h.textContent === 'Theme')`,
      5000,
    );

    // Custom → manual editor with 12 rows
    await conn.evaluate(
      `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Custom')).click()`,
    );
    await conn.waitForFunction(
      `document.querySelectorAll('input[type="text"]').length >= 12`,
      5000,
    );

    // Type a distinctive color into the Accent row. Label-anchored lookup +
    // native value setter + input event (React controlled input).
    const setOk = (await conn.evaluate(`(() => {
      for (const label of document.querySelectorAll('label')) {
        if (label.textContent.trim() !== 'Accent') continue;
        const input = label.closest('div')?.querySelector('input[type="text"]');
        if (!input) return 'no input';
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value',
        ).set;
        setter.call(input, '#ab05cd');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return 'ok';
      }
      return 'no Accent row';
    })()`)) as string;
    assert(setOk === "ok", `could not type into the Accent row: ${setOk}`);

    // Save - the exact flow that used to persist the default palette
    const saved = (await conn.evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(
        (x) => x.textContent.trim() === 'Save',
      );
      if (!b) return false;
      b.click();
      return true;
    })()`)) as boolean;
    assert(saved, "Save button not found");

    // The modal closes on save - wait for the re-render so state settles.
    await conn.waitForFunction(
      `![...document.querySelectorAll('h2')].some((h) => h.textContent === 'Theme')`,
      5000,
    );

    const afterSave = (await conn.evaluate(`(() => ({
      dataTheme: document.documentElement.getAttribute('data-theme'),
      accent: getComputedStyle(document.documentElement)
        .getPropertyValue('--accent')
        .trim(),
      lsTheme: localStorage.getItem('taskman_theme'),
      lsCustom: localStorage.getItem('taskman_custom_colors'),
      styleTag: document.getElementById('taskman-custom-theme')?.textContent ?? null,
    }))()`)) as {
      dataTheme: string | null;
      accent: string;
      lsTheme: string | null;
      lsCustom: string | null;
      styleTag: string | null;
    };

    assert(
      afterSave.dataTheme === "custom",
      `data-theme is ${afterSave.dataTheme}, expected "custom"`,
    );
    assert(
      afterSave.accent === "#ab05cd",
      `--accent computed to ${afterSave.accent}, expected the typed #ab05cd - ` +
        `the custom theme saved the wrong palette`,
    );
    assert(
      afterSave.lsTheme === "custom",
      `localStorage taskman_theme is ${afterSave.lsTheme}, expected "custom"`,
    );
    const savedColors = JSON.parse(afterSave.lsCustom ?? "{}") as Record<
      string,
      string
    >;
    assert(
      savedColors["--accent"] === "#ab05cd",
      `persisted --accent is ${savedColors["--accent"]}, expected #ab05cd`,
    );
    assert(
      (afterSave.styleTag ?? "").includes("--accent: #ab05cd"),
      "injected style tag does not carry the typed accent",
    );

    // Reload - the custom theme must come back exactly as saved
    await conn.evaluate("location.reload()");
    await waitForApp(conn, { wasmReady: true });
    await conn.waitForFunction(
      `!!document.getElementById('taskman-custom-theme')`,
      5000,
    );
    const afterReload = (await conn.evaluate(`(() => ({
      dataTheme: document.documentElement.getAttribute('data-theme'),
      accent: getComputedStyle(document.documentElement)
        .getPropertyValue('--accent')
        .trim(),
    }))()`)) as { dataTheme: string | null; accent: string };
    assert(
      afterReload.dataTheme === "custom",
      `after reload data-theme is ${afterReload.dataTheme}`,
    );
    assert(
      afterReload.accent === "#ab05cd",
      `after reload --accent is ${afterReload.accent}, expected #ab05cd`,
    );
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Calendar picker - the create/edit modal's themed picker replaces the native
// datetime-local input. Picking a day must land the deadline in the persisted
// workspace through the same "YYYY-MM-DDTHH:mm" wire format the modal always
// used (native popups are browser chrome the harness cannot drive - the
// custom grid is plain DOM, which is exactly why it is testable here).
// ---------------------------------------------------------------------------

test("calendar picker: create-node flow sets a deadline that persists", async () => {
  const { conn, close } = await startTestSession();
  try {
    await waitForApp(conn, { wasmReady: true });

    // Start clean - a port collision with an earlier run could leak state.
    // Pin the display zone to UTC so wall-clock display equals the stored
    // wire value on any host.
    await conn.evaluate("localStorage.clear()");
    await conn.evaluate(`localStorage.setItem('taskman_display_tz', 'UTC')`);
    await conn.evaluate("location.reload()");
    await waitForApp(conn, { wasmReady: true });

    // Create node -> modal with the themed picker
    await conn.evaluate(
      `document.querySelector('button[title="Add node"]').click()`,
    );
    await conn.waitForFunction(
      `!!document.querySelector('[aria-label="Deadline date"]')`,
      5000,
    );

    // Open the month grid
    await conn.evaluate(
      `document.querySelector('[aria-label="Deadline date"]').click()`,
    );
    await conn.waitForFunction(
      `!!document.querySelector('[role="dialog"]')`,
      5000,
    );

    // Pick the 15th of the visible (current) month via its aria-label.
    const pick = (await conn.evaluate(`(() => {
      const now = new Date();
      const label = now.toLocaleString("en", { month: "long" }) + " 15, " + now.getFullYear();
      const btn = [...document.querySelectorAll('[role="dialog"] button')]
        .find((b) => b.getAttribute("aria-label") === label);
      if (!btn) return "no day button: " + label;
      btn.click();
      return "ok";
    })()`)) as string;
    assert(pick === "ok", `could not pick a day: ${pick}`);

    // Field shows the picked date; the time input activates at midnight.
    await conn.waitForFunction(
      `/^\\d{4}-\\d{2}-15$/.test(document.querySelector('[aria-label="Deadline date"] span').textContent)`,
      5000,
    );
    await conn.waitForFunction(
      `document.querySelector('[aria-label="Deadline time"]').textContent === "00:00"`,
      5000,
    );

    // Set a distinctive time through the themed time picker: open its
    // popover, pick hour 14 (stays open), then minute 30 (completes+ closes).
    await conn.evaluate(
      `document.querySelector('[aria-label="Deadline time"]').click()`,
    );
    await conn.waitForFunction(
      `!!document.querySelector('[aria-label="Pick a deadline time"]')`,
      5000,
    );
    const hourSet = (await conn.evaluate(`(() => {
      const btn = document.querySelector('[aria-label="Hour 14"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`)) as boolean;
    assert(hourSet, "hour cell not found in the time picker");
    const minuteSet = (await conn.evaluate(`(() => {
      const btn = document.querySelector('[aria-label="Minute 30"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`)) as boolean;
    assert(minuteSet, "minute cell not found in the time picker");
    await conn.waitForFunction(
      `document.querySelector('[aria-label="Deadline time"]').textContent === "14:30"`,
      5000,
    );

    // Save and let the modal close (addNode runs through WASM).
    const saved = (await conn.evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(
        (x) => x.textContent.trim() === 'Save',
      );
      if (!b) return false;
      b.click();
      return true;
    })()`)) as boolean;
    assert(saved, "Save button not found");
    await conn.waitForFunction(
      `!document.querySelector('[aria-label="Deadline date"]')`,
      5000,
    );

    // The deadline must reach the persisted workspace (ISO UTC).
    let stored = "";
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      stored = (await conn.evaluate(
        "localStorage.getItem('taskman_workspace') ?? ''",
      )) as string;
      if (stored.includes("T14:30:00")) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert(
      stored.includes("T14:30:00"),
      "picked deadline did not reach the persisted workspace YAML",
    );
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// color-scheme per theme: dark themes must declare color-scheme: dark (and
// light themes light) so the UA-rendered widgets that remain - the time
// input's chrome, scrollbars, selects - render at the theme's lightness.
// ---------------------------------------------------------------------------

test("themes declare color-scheme matching their lightness", async () => {
  const { conn, close } = await startTestSession();
  try {
    await waitForApp(conn, { wasmReady: true });

    const schemeFor = async (theme: string): Promise<string> => {
      await conn.evaluate(
        `localStorage.setItem('taskman_theme', ${JSON.stringify(theme)})`,
      );
      await conn.evaluate("location.reload()");
      await waitForApp(conn, { wasmReady: true });
      return (await conn.evaluate(
        "getComputedStyle(document.documentElement).colorScheme",
      )) as string;
    };

    assert(
      (await schemeFor("carbon-noir")) === "dark",
      "carbon-noir should declare color-scheme: dark",
    );
    assert(
      (await schemeFor("banana-crisis")) === "light",
      "banana-crisis should declare color-scheme: light",
    );
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Popover clipping - the deadline popovers used to render position:absolute
// inside the modal card's overflow-y:auto box, so near the card bottom they
// were cut off by up to 113px (time) / 45px (date) until the user scrolled.
// The contract: every pixel of an open popover is visible without scrolling
// the modal - either it lives inside the scroll container's visible box, or
// it is position:fixed and fully inside the viewport.
// ---------------------------------------------------------------------------

/** Visibility check for one popover, parameterized by its aria-labels. */
function popoverVisibleCheck(popoverLabel: string, fieldLabel: string): string {
  return `(() => {
    const pop = document.querySelector('[aria-label="${popoverLabel}"]');
    if (!pop) return "no popover";
    const field = document.querySelector('[aria-label="${fieldLabel}"]');
    if (!field) return "no field";
    let el = field.parentElement, card = null;
    while (el) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === "auto" || oy === "scroll") { card = el; break; }
      el = el.parentElement;
    }
    const r = pop.getBoundingClientRect();
    const pos = getComputedStyle(pop).position;
    const inViewport = r.top >= 0 && r.bottom <= window.innerHeight &&
      r.left >= 0 && r.right <= window.innerWidth;
    let visible;
    if (pos === "fixed") {
      visible = inViewport;
    } else if (card) {
      const c = card.getBoundingClientRect();
      visible = r.bottom <= c.bottom + 1 && r.top >= c.top - 1;
    } else {
      visible = inViewport;
    }
    return visible ? "ok"
      : "clipped: pos=" + pos + " pop=" + Math.round(r.top) + "-" + Math.round(r.bottom) +
        " card=" + (card ? Math.round(card.getBoundingClientRect().bottom) : "none");
  })()`;
}

test("deadline popovers render fully visible without scrolling the modal", async () => {
  const { conn, close } = await startTestSession();
  try {
    await waitForApp(conn, { wasmReady: true });
    await conn.evaluate("localStorage.clear()");
    await conn.evaluate("location.reload()");
    await waitForApp(conn, { wasmReady: true });

    // Sane desktop viewport (the harness default is only 800x600, where the
    // modal itself is small; the defect shows at real window sizes).
    await conn.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 960,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await conn.evaluate(
      `document.querySelector('button[title="Add node"]').click()`,
    );
    await conn.waitForFunction(
      `!!document.querySelector('[aria-label="Deadline date"]')`,
      5000,
    );

    // Date popover
    await conn.evaluate(
      `document.querySelector('[aria-label="Deadline date"]').click()`,
    );
    await conn.waitForFunction(
      `!!document.querySelector('[aria-label="Pick a deadline date"]')`,
      5000,
    );
    const dateCheck = (await conn.evaluate(
      popoverVisibleCheck("Pick a deadline date", "Deadline date"),
    )) as string;
    assert(dateCheck === "ok", `date popover not fully visible: ${dateCheck}`);
    await conn.evaluate(
      `document.querySelector('[aria-label="Deadline date"]').click()`,
    );
    await conn.waitForFunction(
      `!document.querySelector('[aria-label="Pick a deadline date"]')`,
      5000,
    );

    // Pick day 15 to enable the time control
    await conn.evaluate(
      `document.querySelector('[aria-label="Deadline date"]').click()`,
    );
    await conn.waitForFunction(
      `!!document.querySelector('[aria-label="Pick a deadline date"]')`,
      5000,
    );
    const picked = (await conn.evaluate(`(() => {
      const now = new Date();
      const label = now.toLocaleString("en", { month: "long" }) + " 15, " + now.getFullYear();
      const btn = [...document.querySelectorAll('[role="dialog"] button')]
        .find((b) => b.getAttribute("aria-label") === label);
      if (!btn) return false;
      btn.click();
      return true;
    })()`)) as boolean;
    assert(picked, "day button not found");

    // Time popover
    await conn.waitForFunction(
      `document.querySelector('[aria-label="Deadline time"]').textContent !== "--:--"`,
      5000,
    );
    await conn.evaluate(
      `document.querySelector('[aria-label="Deadline time"]').click()`,
    );
    await conn.waitForFunction(
      `!!document.querySelector('[aria-label="Pick a deadline time"]')`,
      5000,
    );
    const timeCheck = (await conn.evaluate(
      popoverVisibleCheck("Pick a deadline time", "Deadline time"),
    )) as string;
    assert(timeCheck === "ok", `time popover not fully visible: ${timeCheck}`);
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Display time zone - deadlines render as wall time in the selected zone
// while the stored data stays UTC. UTC is pinned first so wall display
// equals the wire value; switching to Asia/Kolkata (+5:30) must shift the
// display WITHOUT touching the persisted workspace.
// ---------------------------------------------------------------------------

test("display timezone: render shifts, stored data stays UTC", async () => {
  const { conn, close } = await startTestSession();
  try {
    await waitForApp(conn, { wasmReady: true });
    await conn.evaluate("localStorage.clear()");
    await conn.evaluate(`localStorage.setItem('taskman_display_tz', 'UTC')`);
    await conn.evaluate("location.reload()");
    await waitForApp(conn, { wasmReady: true });

    await conn.evaluate(
      `document.querySelector('button[title="Add node"]').click()`,
    );
    await conn.waitForFunction(
      `!!document.querySelector('[aria-label="Deadline date"]')`,
      5000,
    );

    // Pick day 15, 14:30 via the time picker
    await conn.evaluate(
      `document.querySelector('[aria-label="Deadline date"]').click()`,
    );
    await conn.waitForFunction(
      `!!document.querySelector('[aria-label="Pick a deadline date"]')`,
      5000,
    );
    const picked = (await conn.evaluate(`(() => {
      const now = new Date();
      const label = now.toLocaleString("en", { month: "long" }) + " 15, " + now.getFullYear();
      const btn = [...document.querySelectorAll('[role="dialog"] button')]
        .find((b) => b.getAttribute("aria-label") === label);
      if (!btn) return false;
      btn.click();
      return true;
    })()`)) as boolean;
    assert(picked, "day button not found");
    await conn.waitForFunction(
      `document.querySelector('[aria-label="Deadline time"]').textContent !== "--:--"`,
      5000,
    );
    await conn.evaluate(
      `document.querySelector('[aria-label="Deadline time"]').click()`,
    );
    await conn.waitForFunction(
      `!!document.querySelector('[aria-label="Pick a deadline time"]')`,
      5000,
    );
    await conn.evaluate(
      `document.querySelector('[aria-label="Hour 14"]').click()`,
    );
    await conn.evaluate(
      `document.querySelector('[aria-label="Minute 30"]').click()`,
    );
    await conn.waitForFunction(
      `document.querySelector('[aria-label="Deadline time"]').textContent === "14:30"`,
      5000,
    );

    // Save - with UTC display the stored wire value is 14:30Z.
    await conn.evaluate(
      `[...document.querySelectorAll('button')]
        .find((x) => x.textContent.trim() === 'Save').click()`,
    );
    await conn.waitForFunction(
      `!document.querySelector('[aria-label="Deadline date"]')`,
      5000,
    );
    let stored = "";
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      stored = (await conn.evaluate(
        "localStorage.getItem('taskman_workspace') ?? ''",
      )) as string;
      if (stored.includes("T14:30:00")) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert(stored.includes("T14:30:00"), "deadline not stored as 14:30Z");

    // Reopen the node (dblclick its title text) and switch the display zone
    // to Asia/Calcutta (+5:30; Chromium exposes the CLDR-canonical id): the
    // same stored instant must render as 20:00.
    await conn.waitForFunction(
      `[...document.querySelectorAll('svg text')].some((t) => t.textContent === 'Untitled')`,
      5000,
    );
    await conn.evaluate(
      `[...document.querySelectorAll('svg text')]
        .find((t) => t.textContent === 'Untitled')
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`,
    );
    await conn.waitForFunction(
      `!!document.querySelector('[aria-label="Deadline date"]')`,
      5000,
    );
    await conn.waitForFunction(
      `document.querySelector('[aria-label="Deadline time"]').textContent === "14:30"`,
      5000,
    );
    await conn.evaluate(
      `document.querySelector('[aria-label="Display time zone"]').click()`,
    );
    await conn.waitForFunction(
      `!!document.querySelector('[aria-label="Pick a display time zone"]')`,
      5000,
    );

    // The zone list shows a ~5-entry window; search + scroll reach the rest.
    await conn.waitForFunction(
      `!!document.querySelector('[aria-label="Time zone list"]')`,
      5000,
    );
    const zoneWindow = (await conn.evaluate(`(() => {
      const list = document.querySelector('[aria-label="Time zone list"]');
      const row = list.querySelector("button");
      return {
        listH: list.clientHeight,
        rowH: row ? row.getBoundingClientRect().height : 0,
      };
    })()`)) as { listH: number; rowH: number };
    assert(
      zoneWindow.rowH > 0 && zoneWindow.listH <= zoneWindow.rowH * 5 + 12,
      `zone list window should show ~5 entries: ${JSON.stringify(zoneWindow)}`,
    );

    const zoneSet = (await conn.evaluate(`(() => {
      const input = document.querySelector('[aria-label="Search time zones"]');
      if (!input) return "no search input";
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(input, "Calcutta");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return "ok";
    })()`)) as string;
    assert(zoneSet === "ok", `could not search zones: ${zoneSet}`);
    await conn.waitForFunction(
      `!!document.querySelector('[aria-label="Asia/Calcutta"]')`,
      5000,
    );
    await conn.evaluate(
      `document.querySelector('[aria-label="Asia/Calcutta"]').click()`,
    );
    await conn.waitForFunction(
      `document.querySelector('[aria-label="Deadline time"]').textContent === "20:00"`,
      5000,
    );

    // The stored workspace must not have moved.
    stored = (await conn.evaluate(
      "localStorage.getItem('taskman_workspace') ?? ''",
    )) as string;
    assert(
      stored.includes("T14:30:00"),
      "switching the display zone mutated the stored deadline",
    );
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Typed time entry - segments strip letters/symbols and clamp to the valid
// range (0-23 / 0-59), applying the sanitized value live.
// ---------------------------------------------------------------------------

test("typed time entry: letters ignored, values clamped", async () => {
  const { conn, close } = await startTestSession();
  try {
    await waitForApp(conn, { wasmReady: true });
    await conn.evaluate("localStorage.clear()");
    await conn.evaluate(`localStorage.setItem('taskman_display_tz', 'UTC')`);
    await conn.evaluate("location.reload()");
    await waitForApp(conn, { wasmReady: true });

    await conn.evaluate(
      `document.querySelector('button[title="Add node"]').click()`,
    );
    await conn.waitForFunction(
      `!!document.querySelector('[aria-label="Deadline date"]')`,
      5000,
    );

    // Pick day 15 so the time control enables
    await conn.evaluate(
      `document.querySelector('[aria-label="Deadline date"]').click()`,
    );
    await conn.waitForFunction(
      `!!document.querySelector('[aria-label="Pick a deadline date"]')`,
      5000,
    );
    const picked = (await conn.evaluate(`(() => {
      const now = new Date();
      const label = now.toLocaleString("en", { month: "long" }) + " 15, " + now.getFullYear();
      const btn = [...document.querySelectorAll('[role="dialog"] button')]
        .find((b) => b.getAttribute("aria-label") === label);
      if (!btn) return false;
      btn.click();
      return true;
    })()`)) as boolean;
    assert(picked, "day button not found");
    await conn.waitForFunction(
      `document.querySelector('[aria-label="Deadline time"]').textContent !== "--:--"`,
      5000,
    );

    await conn.evaluate(
      `document.querySelector('[aria-label="Deadline time"]').click()`,
    );
    await conn.waitForFunction(
      `!!document.querySelector('[aria-label="Pick a deadline time"]')`,
      5000,
    );

    const typeSegment = (label: string, text: string): string => `(() => {
      const input = document.querySelector('[aria-label="${label}"]');
      if (!input) return "no input";
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(input, ${JSON.stringify(text)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return input.value;
    })()`;

    // Letters ignored: "ab9" sanitizes to "9" and applies as hour 09.
    const hour1 = (await conn.evaluate(
      typeSegment("Deadline time hour", "ab9"),
    )) as string;
    assert(hour1 === "9", `hour segment did not sanitize: ${hour1}`);
    await conn.waitForFunction(
      `document.querySelector('[aria-label="Deadline time"]').textContent === "09:00"`,
      5000,
    );

    // Out-of-range clamps: "25" becomes 23.
    const hour2 = (await conn.evaluate(
      typeSegment("Deadline time hour", "25"),
    )) as string;
    assert(hour2 === "23", `hour segment did not clamp: ${hour2}`);

    // Minutes: "1x5" -> "15".
    const minute1 = (await conn.evaluate(
      typeSegment("Deadline time minute", "1x5"),
    )) as string;
    assert(minute1 === "15", `minute segment did not sanitize: ${minute1}`);
    await conn.waitForFunction(
      `document.querySelector('[aria-label="Deadline time"]').textContent === "23:15"`,
      5000,
    );
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Popover exclusivity + wheel stability - the deadline popovers used to
// (a) close the moment their own wheel scrolled (the scroll-close listener
// caught the wheel's scroll events) and (b) stack on top of each other,
// since each picker held independent open state.
// ---------------------------------------------------------------------------

test("time popover stays open while its wheels scroll", async () => {
  const { conn, close } = await startTestSession();
  try {
    await waitForApp(conn, { wasmReady: true });
    await conn.evaluate("localStorage.clear()");
    await conn.evaluate(`localStorage.setItem('taskman_display_tz', 'UTC')`);
    await conn.evaluate("location.reload()");
    await waitForApp(conn, { wasmReady: true });

    await conn.evaluate(
      `document.querySelector('button[title="Add node"]').click()`,
    );
    await conn.waitForFunction(
      `!!document.querySelector('[aria-label="Deadline date"]')`,
      5000,
    );
    await conn.evaluate(
      `document.querySelector('[aria-label="Deadline date"]').click()`,
    );
    await conn.waitForFunction(
      `!!document.querySelector('[aria-label="Pick a deadline date"]')`,
      5000,
    );
    const picked = (await conn.evaluate(`(() => {
      const now = new Date();
      const label = now.toLocaleString("en", { month: "long" }) + " 15, " + now.getFullYear();
      const btn = [...document.querySelectorAll('[role="dialog"] button')]
        .find((b) => b.getAttribute("aria-label") === label);
      if (!btn) return false;
      btn.click();
      return true;
    })()`)) as boolean;
    assert(picked, "day button not found");
    await conn.waitForFunction(
      `document.querySelector('[aria-label="Deadline time"]').textContent !== "--:--"`,
      5000,
    );
    await conn.evaluate(
      `document.querySelector('[aria-label="Deadline time"]').click()`,
    );
    await conn.waitForFunction(
      `!!document.querySelector('[aria-label="Pick a deadline time"]')`,
      5000,
    );

    // Scroll the minutes wheel (programmatic scrollTop fires real scroll
    // events - exactly what a user's drag produces). The popover must stay
    // open and the value under the wheel must apply.
    const scrolled = (await conn.evaluate(`(() => {
      const dialog = document.querySelector('[aria-label="Pick a deadline time"]');
      if (!dialog) return "no dialog";
      const scrollers = [...dialog.querySelectorAll("div")].filter(
        (d) => d.scrollHeight > d.clientHeight + 10,
      );
      if (!scrollers.length) return "no scroller";
      scrollers[scrollers.length - 1].scrollTop = 20 * 32; // minute 20
      return "ok";
    })()`)) as string;
    assert(scrolled === "ok", `could not scroll the wheel: ${scrolled}`);

    // The scrolled-to value applies (minute 20 under hour 00).
    await conn.waitForFunction(
      `document.querySelector('[aria-label="Deadline time"]').textContent === "00:20"`,
      5000,
    );

    // ...and the popover is still there after the scroll events settle.
    for (let i = 0; i < 5; i++) {
      const present = (await conn.evaluate(
        `!!document.querySelector('[aria-label="Pick a deadline time"]')`,
      )) as boolean;
      assert(present, "time popover closed while its wheel scrolled");
      await new Promise((r) => setTimeout(r, 100));
    }

    // Chevron steppers: "Increase hours" steps the hour (00 -> 01).
    await conn.evaluate(
      `document.querySelector('[aria-label="Increase hours"]').click()`,
    );
    await conn.waitForFunction(
      `document.querySelector('[aria-label="Deadline time"]').textContent === "01:20"`,
      5000,
    );

    // Chevrons live in their own rows above/below the scroller - never on
    // top of the scroll values. (Checked at hour 1, where both chevrons
    // exist.)
    const geom = (await conn.evaluate(`(() => {
      const q = (label) => document.querySelector('[aria-label="' + label + '"]');
      const r = (el) => el.getBoundingClientRect();
      const dialog = document.querySelector('[aria-label="Pick a deadline time"]');
      const scrollers = [...dialog.querySelectorAll("div")].filter(
        (d) => d.scrollHeight > d.clientHeight + 10,
      );
      const hourScroller = r(scrollers[0]);
      const up = r(q("Decrease hours"));
      const down = r(q("Increase hours"));
      return {
        upAbove: up.bottom <= hourScroller.top + 2,
        downBelow: down.top >= hourScroller.bottom - 2,
      };
    })()`)) as { upAbove: boolean; downBelow: boolean };
    assert(
      geom.upAbove && geom.downBelow,
      `chevrons overlap the wheel values: ${JSON.stringify(geom)}`,
    );

    await conn.evaluate(
      `document.querySelector('[aria-label="Decrease hours"]').click()`,
    );
    await conn.waitForFunction(
      `document.querySelector('[aria-label="Deadline time"]').textContent === "00:20"`,
      5000,
    );
  } finally {
    await close();
  }
});

test("deadline popovers are mutually exclusive", async () => {
  const { conn, close } = await startTestSession();
  try {
    await waitForApp(conn, { wasmReady: true });
    await conn.evaluate("localStorage.clear()");
    await conn.evaluate(`localStorage.setItem('taskman_display_tz', 'UTC')`);
    await conn.evaluate("location.reload()");
    await waitForApp(conn, { wasmReady: true });

    await conn.evaluate(
      `document.querySelector('button[title="Add node"]').click()`,
    );
    await conn.waitForFunction(
      `!!document.querySelector('[aria-label="Deadline date"]')`,
      5000,
    );

    // Pick day 15 so the time control enables
    await conn.evaluate(
      `document.querySelector('[aria-label="Deadline date"]').click()`,
    );
    await conn.waitForFunction(
      `!!document.querySelector('[aria-label="Pick a deadline date"]')`,
      5000,
    );
    const picked = (await conn.evaluate(`(() => {
      const now = new Date();
      const label = now.toLocaleString("en", { month: "long" }) + " 15, " + now.getFullYear();
      const btn = [...document.querySelectorAll('[role="dialog"] button')]
        .find((b) => b.getAttribute("aria-label") === label);
      if (!btn) return false;
      btn.click();
      return true;
    })()`)) as boolean;
    assert(picked, "day button not found");
    await conn.waitForFunction(
      `document.querySelector('[aria-label="Deadline time"]').textContent !== "--:--"`,
      5000,
    );

    // Open the TIME popover, then click the DATE field: the time popover
    // must close instead of stacking under the date popover.
    await conn.evaluate(
      `document.querySelector('[aria-label="Deadline time"]').click()`,
    );
    await conn.waitForFunction(
      `!!document.querySelector('[aria-label="Pick a deadline time"]')`,
      5000,
    );
    await conn.evaluate(
      `document.querySelector('[aria-label="Deadline date"]').click()`,
    );
    await conn.waitForFunction(
      `!!document.querySelector('[aria-label="Pick a deadline date"]')`,
      5000,
    );
    const timeGone = (await conn.evaluate(
      `!document.querySelector('[aria-label="Pick a deadline time"]')`,
    )) as boolean;
    assert(timeGone, "time popover still open next to the date popover");

    // Same for the zone chip: opening it closes the date popover.
    await conn.evaluate(
      `document.querySelector('[aria-label="Display time zone"]').click()`,
    );
    await conn.waitForFunction(
      `!!document.querySelector('[aria-label="Pick a display time zone"]')`,
      5000,
    );
    const dateGone = (await conn.evaluate(
      `!document.querySelector('[aria-label="Pick a deadline date"]')`,
    )) as boolean;
    assert(dateGone, "date popover still open next to the zone popover");
  } finally {
    await close();
  }
});
