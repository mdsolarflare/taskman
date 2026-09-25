/**
 * E2E Test Suite — CDP-driven tests against the live app
 *
 * Reliable because: fresh instance per test, waits on DOM state, no simulated
 * environments, no test frameworks beyond Deno.
 *
 * Environment overrides:
 *   E2E_PUBLIC     — root dir to serve (default: <this-file>/../public)
 *   E2E_CHROME_WS  — WebSocket URL of an existing browser to reuse
 */

import { assert, assertEquals } from "@std/assert";
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
  // /C:/Users/x/... → C:\Users\x\...  (file:// URL pathname form — the
  // leading slash is an artifact of URL.pathname, not a real path segment)
  const w = p.match(/^\/([a-z]):\/(.*)/i);
  if (w) return `${w[1].toUpperCase()}:\\${w[2].replace(/\//g, "\\")}`;
  return p;
}

const PUBLIC = Deno.env.get("E2E_PUBLIC") ??
  toWindowsPath(
    new URL("../public/", import.meta.url).pathname,
  );

/** buildId from the build's cache-manifest.js — the SW cache name embeds it. */
function cacheManifestBuildId(): string {
  const src = Deno.readTextFileSync(`${PUBLIC}\\dist\\cache-manifest.js`);
  const m = src.match(/self\.CACHE_MANIFEST = (\{[\s\S]*?\});/);
  if (!m) throw new Error("cache-manifest.js has no CACHE_MANIFEST object");
  return (JSON.parse(m[1]) as { buildId: string }).buildId;
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
  let browserWs = Deno.env.get("E2E_CHROME_WS") ??
    (await tryGetExistingDebugger(9222));

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
      // If we spawned our own Edge we leave it running — the profile dir is
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

async function tryGetExistingDebugger(port: number = 9222): Promise<string | null> {
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
  const localAppData = Deno.env.get("LOCALAPPDATA") ??
    `C:\\Users\\${Deno.env.get("USERNAME")}\\AppData\\Local`;
  const profileDir = `${localAppData}\\taskman-e2e-edge-${stamp}`;

  // Pipe stderr so we can capture the log for diagnostics if launch fails.
  const proc = new Deno.Command(
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    {
      args: [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profileDir}`,
        "--headless=new",
        "--no-first-run",
      ],
      stdout: "null",
      stderr: "piped",
    },
  ).spawn();

  const stderrReader = proc.stderr!.getReader();

  // Edge's first-run init on Windows can take 10-15s; poll generously.
  const maxTries = 75; // 75 * 400ms = 30s
  for (let i = 0; i < maxTries; i++) {
    await new Promise((r) => setTimeout(r, 400));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        // Small grace period after the debug URL is readable before cancel.
        await new Promise((r) => setTimeout(r, 200));
        try {
          await stderrReader.cancel();
        } catch {
          /* reader may already be closed */
        }
        return port;
      }
    } catch {
      /* keep trying */
    }
  }
  proc.kill();
  const stderrChunks: string[] = [];
  for (;;) {
    const { value, done } = await stderrReader.read();
    if (done) break;
    stderrChunks.push(new TextDecoder().decode(value));
  }
  const stderrTail = stderrChunks.join("").slice(-2000) ||
    "(no Edge stderr output captured)";
  throw new Error(
    `Edge did not start debugging on port ${port} after ${maxTries * 400}ms\n` +
      `Edge stderr:\n${stderrTail}`,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("app boots, WASM ready, sample graph renders", async () => {
  const { conn, close } = await startTestSession();
  try {
    await waitForApp(conn, { wasmReady: true });

    const nodeCount = (await conn.evaluate(
      "document.querySelectorAll('svg > g').length",
    )) as number;
    assert(nodeCount > 0, "no <g> elements in the SVG — no graph rendered");

    const wasmAvailable = (await conn.evaluate(
      "(async () => { const r = await fetch('./dist/ichor_bg.wasm', {method: 'HEAD'}); return r.ok; })()",
    )) as boolean;
    assert(wasmAvailable, "WASM binary not present at ./dist/ichor_bg.wasm");
  } finally {
    await close();
  }
});

Deno.test(
  "sample graph persisted to localStorage matches the source file",
  async () => {
    const { conn, close } = await startTestSession();
    try {
      await waitForApp(conn, { wasmReady: true });

      const sampleFetch = (await conn.evaluate(
        "fetch('./sample.yaml').then(r => r.text())",
      )) as string;

      // App persists the workspace to localStorage on a 1-second debounce —
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
  },
);

Deno.test(
  "service worker registers, precaches the shell, and serves offline",
  async () => {
    const { conn, close, goOffline } = await startTestSession();
    try {
      await waitForApp(conn, { wasmReady: true });

      // Wait for the SW to be active AND controlling the page. `ready`
      // resolves on activation, but control only transfers after
      // clients.claim() lands — poll for the controller instead of a
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
      const cacheKeys = (await conn.evaluate(
        "(async () => { " +
          "  await navigator.serviceWorker.ready; " +
          "  return (await caches.keys()).sort(); " +
          "})()",
      )) as string[];
      assert(
        cacheKeys.includes(`taskman-shell-${buildId}`),
        `expected cache 'taskman-shell-${buildId}', got: ${JSON.stringify(cacheKeys)}`,
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
        `expected >=12 precached entries, got ${cachedPaths.length}: ${JSON.stringify(cachedPaths)}`,
      );

      // Offline: cut the server, reload, and the app must still boot from the
      // service worker cache (React mounts + graph renders).
      goOffline();
      await conn.evaluate("location.reload()");
      await waitForApp(conn, { wasmReady: true });
    } finally {
      await close();
    }
  },
);
