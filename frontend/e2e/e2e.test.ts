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
