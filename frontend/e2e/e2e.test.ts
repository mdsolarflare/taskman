/**
 * E2E Test Suite — CDP-driven tests against the live app
 * Reliable because: fresh instance per test, waits on DOM state, no simulated
 * environments, no test frameworks beyond Deno.
 */

import { assert, assertEquals } from "@std/assert";
import { CdpSession, openBrowserPage } from "./cdp.ts";
import { serveStaticDir } from "./serve.ts";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PUBLIC = Deno.env.get("E2E_PUBLIC") ??
  new URL("../frontend/public/", import.meta.url).pathname
    .replace(/^\/([A-Za-z]:\/)/, "$1");

// No timeout on Edge launch detection — we take as long as needed.
// This is a *test* helper, not a runtime concern.

// ---------------------------------------------------------------------------
// Test harness: one browser, fresh tab per test, auto-launch if needed
// ---------------------------------------------------------------------------

interface TestSession {
  conn: CdpSession;
  close: () => Promise<void>;
}

async function startTestSession(): Promise<TestSession> {
  const server = serveStaticDir(PUBLIC);
  let ownLaunch = false;
  let browserWs = Deno.env.get("E2E_CHROME_WS") ??
    (await tryGetExistingDebugger());

  if (!browserWs) {
    ownLaunch = true;
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
  const profileDir =
    `${Deno.env.get("LOCALAPPDATA")}\\taskman-e2e-edge-${stamp}`;

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
        await stderrReader.cancel();
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

Deno.test("app boots, WASM ready, sample graph renders", async (t) => {
  await t.step("boot browser target and attach CDP session", async () => {
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
});

Deno.test("sample graph persisted to localStorage matches the source file", async (t) => {
  await t.step("visit app in fresh browser tab, trigger WASM init, then verify localStorage workspace matches sample.yaml", async () => {
    const { conn, close } = await startTestSession();
    try {
      await waitForApp(conn, { wasmReady: true });

      const sampleFetch = await conn.evaluate(
        "fetch('./sample.yaml').then(r => r.text())",
      ) as string;
      const fromStorage = await conn.evaluate(
        "localStorage.getItem('taskman_workspace')",
      ) as string | null;

      assertEquals(
        fromStorage,
        sampleFetch,
        "localStorage workspace does not match /sample.yaml for a first-time visit",
      );
    } finally {
      await close();
    }
  });
});
