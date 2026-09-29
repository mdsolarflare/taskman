# PWA Conversion + E2E Harness Resurrection

**Date:** 2026-09-25 | Updated: 2026-09-26 (Bug 5: SW update cycle)
**Files:** `frontend/e2e/serve.ts`, `frontend/e2e/cdp.ts`, `frontend/e2e/e2e.test.ts`, `frontend/e2e/gen_icons.ts`, `frontend/public/sw.js`, `frontend/public/manifest.webmanifest`, `frontend/gen-revision.ts`, `frontend/src/hooks/usePWA.ts`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/public/index.html`
**Status:** ✅ Resolved — 3 e2e tests pass in headless Edge; fmt/lint/test/clippy all exit 0

---

## Problem Statement

The `convert-to-pwa` worktree had a dead e2e harness (every test timed out
waiting for React to mount) and no PWA. Task: fix the harness, then ship
icons + manifest + service worker + install/update UI, all zero-dependency,
verified by real browser tests.

---

## Context

- The e2e suite drives headless Edge via raw CDP (no Playwright/Puppeteer):
  an in-process `Deno.serve` static server, `Target.createTarget` +
  `attachToTarget`, and `Runtime.evaluate` polling.
- The prior session's handoff claimed the root cause was
  `Deno.stat(URL)` failing on Windows. Verified against Deno 2.9.7:
  `Deno.stat(fileURL)` **works**. The claim was stale — the real bugs were
  elsewhere (below).
- The deploy target is a GitHub Pages subpath (`/taskman/`), so every
  manifest/SW path is relative (`./`), and bundle filenames are stable
  (no content hashes) — which makes SW-driven staleness the central design
  risk.

---

## Bugs Found (5)

### Bug 1: `new URL("/abs/path", root)` discards the base on Windows

**Location:** `e2e/serve.ts` (pre-fix: L59-62)
**Symptom:** every static file returned index.html's 853 bytes with
`text/html` — the browser saw HTML where it expected `main.js`.

A URL whose path starts with `/` resolves against the *origin*, not the
base. On `file:///C:/.../public/`, `new URL("/dist/main.js", root)` became
`file:///dist/main.js`. Every `Deno.stat` failed, and the SPA fallback
served index.html for all real files.

```diff
-    const filePath = new URL(
-      rawPath.replace(/\/$/, "") || "/index.html",
-      root,
-    );
-    const stat = await Deno.stat(filePath).catch(() => null);
+    const relPath = decodeURIComponent(rawPath).replace(/^\/+/, "");
+    const fsPath = relPath === "" ? `${rootPath}/index.html`
+      : `${rootPath}/${relPath}`;
+    const stat = await Deno.stat(fsPath).catch(() => null);
```

Fix: plain string concatenation from an NT-style root, per the cdp-recipe
rule ("never `new URL(rel, fileURL)` on Windows").

### Bug 2: `toWindowsPath` didn't match `URL.pathname` output

**Location:** `e2e/e2e.test.ts` (pre-fix: L21-26)
**Symptom:** all three tests timed out at the first `waitForFunction`, even
with a perfectly healthy app (verified by a standalone probe page boot).

`new URL("../public/", import.meta.url).pathname` on Windows yields
`/C:/Users/...` — with a **colon** after the drive letter. The existing
regex `^\/([c-z])\/(.*)` matches MSYS form `/c/Users/...` but not
`/C:/Users/...`, so PUBLIC stayed a mangled pathname, the server read
nothing, and the page got "Not Found" HTML.

```diff
 function toWindowsPath(p: string): string {
-  // /c/Users/x/... → C:\Users\x\...
   const m = p.match(/^\/([c-z])\/(.*)/i);
   if (m) return `${m[1].toUpperCase()}:${m[2].replace(/\//g, "\\")}`;
+  // /C:/Users/x/... → C:\Users\x\...  (file:// URL pathname form)
+  const w = p.match(/^\/([a-z]):\/(.*)/i);
+  if (w) return `${w[1].toUpperCase()}:\\${w[2].replace(/\//g, "\\")}`;
   return p;
 }
```

### Bug 3: `waitForFunction` called string predicates as functions

**Location:** `e2e/cdp.ts` (pre-fix: L83)
**Symptom:** every wait timed out at exactly its limit; the app was fine.

`waitForFunction("document.querySelector('#root')?.children.length > 0")`
wrapped the string as `(predicate.toString())()` — i.e. `(true)()` — a
TypeError inside the page. `Runtime.evaluate` returns the exception in
`exceptionDetails` while `result.value` stays undefined, so the poll read
`undefined` forever instead of failing loudly.

```diff
-    const expr = `(${predicate.toString()})()`;
+    const expr = typeof predicate === "string"
+      ? predicate
+      : `(${predicate.toString()})()`;
```

### Bug 4: `controllerchange` reload on first SW activation

**Location:** `src/hooks/usePWA.ts`
**Symptom (latent):** every brand-new visitor's page would reload once,
seconds after first load, because `sw.activate()` calls `clients.claim()`
which fires `controllerchange` on a first install too.

```diff
+    const updateApproved = useRef(false);
     const onControllerChange = () => {
-      globalThis.location.reload();
+      if (updateApproved.current) globalThis.location.reload();
     };
     ...
     const applyUpdate = useCallback(() => {
+      updateApproved.current = true;
+      navigator.serviceWorker.getRegistration()?.then((reg) => {
+        reg?.waiting?.postMessage({ type: "SKIP_WAITING" });
+      });
     }, []);
```

Also fixed during the work (not pre-existing): a `Runtime.evaluate` on
`about:blank` taints the canvas (SecurityError on `toDataURL`) when
rasterizing the PWA icons — the generator must `Page.navigate` to the
served origin first.

### Bug 5 (post-demo, Windows): `importScripts`'d manifest changes never triggered a SW update

**Location:** `public/sw.js` + `frontend/gen-revision.ts`
**Symptom:** installed Windows PWA kept the pre-transparency icon
(`#fffde7` corners in Brave's generated `Taskman.ico`) across multiple
rebuilds — the shell was pinned to the first build the browser ever saw.

Chromium's SW update check byte-compares only the **main** script. Our
`sw.js` was static; only `dist/cache-manifest.js` (pulled in via
`importScripts`) changed per build — which the update check never sees. The
revision map existed precisely to defeat permanent caching, but without a
changing main script it was dead code: updates never fired, old precaches
never evicted.

```diff
+// AUTO-STAMPED by gen-revision.ts — do not edit by hand.
+const BUILD_ID = "<sha256 buildId>";   // rewritten by every `deno task build`
+
 importScripts("./dist/cache-manifest.js");
+if (BUILD_ID !== CACHE_MANIFEST.buildId) throw new Error("stale sw.js stamp");
```

`gen-revision.ts` now stamps the buildId into `sw.js` (whitespace-tolerant
regex — `deno fmt` wraps the long line), the SW asserts stamp↔manifest
agreement at install, and the e2e suite asserts the stamp equals the
manifest's buildId. Verified live: touch a shell file → rebuild → the
browser installs the new worker → old cache evicted, new build serving.

---

## Tests Added

`frontend/e2e/e2e.test.ts` (CDP-driven, headless Edge, ~4s):

1. **app boots, WASM ready, sample graph renders** — React mounts, the
   WASM-built graph renders `svg > g` nodes, and the `.wasm` binary is
   fetchable.
2. **sample graph persisted to localStorage matches the source file** —
   first-visit workspace write equals `public/sample.yaml` (polls past the
   app's 1s debounce).
3. **service worker registers, precaches the shell, and serves offline** —
   page is controlled; the stamped `sw.js` `BUILD_ID` must equal the
   manifest's `buildId` (build integrity — guards the Bug 5 class); `caches`
   contains `taskman-shell-<buildId>` read from the built
   `dist/cache-manifest.js`; ≥12 precached entries; then the server is cut
   (`goOffline()`) and a reload still mounts and renders from the SW cache.

The frontend unit suite (`deno task test`) now ignores `e2e/` (excluded in
`frontend/deno.json`, so it never enters the module graph), and the e2e
module keeps its own `deno.json` task.

---

## Takeaways

- **On Windows, resolve file paths by string join from an NT root; never
  `new URL(rel, root)` for request paths, and never trust `URL.pathname`
  without a colon-aware normalizer.** Three separate bugs in this suite were
  the same mistake in three costumes.
- **`Runtime.evaluate` failures are silent** — exceptions land in
  `exceptionDetails` and `result.value` reads as undefined, so a broken
  predicate presents as a timeout, not an error. Probing with a standalone
  page-boot script (which passed) against the full harness (which failed)
  isolated the harness as the culprit within minutes.
- **Stable filenames + SW caching require a revision map *plus* a stamped
  main script.** The `gen-revision` task (SHA-256 over the shell, emitted as
  `dist/cache-manifest.js`, cache named by `buildId`, stale caches deleted
  on activate) is necessary but NOT sufficient: Chromium byte-compares only
  the main `sw.js` on its update check, so the buildId must also be stamped
  into `sw.js` itself or shell updates silently never fire (Bug 5 — the
  revision map alone left installs pinned to their first build).
- **`clients.claim()` fires `controllerchange` on first activation** — gate
  any reload-on-controllerchange behind a user-approval flag.
- **Handoff claims drift; verify against the live tool first.** `Deno.stat(URL)`
  worked on the installed Deno 2.9.7; the actual blockers (bugs 1-3) were
  invisible until the server was probed with a 10-line smoke script.
