# Handoff: taskman/`convert-to-pwa` worktree — E2E + PWA

## Operator rules (learned the hard way)

Your terminal process and your `write_file`/`patch`/`read_file` tools resolve
**relative paths differently**:

- `terminal` honors `cd` and **persists cwd across calls**.
- `write_file`/`patch` resolve relative paths against the **session's original
  cwd**, not the terminal's current cwd.

**If you `cd` into `frontend/e2e` in terminal and then call
`write_file("frontend/e2e/foo.ts", ...)`, you will write to
`frontend/e2e/frontend/e2e/foo.ts` — and the file tool auto-creates parent
directories, resurrecting a phantom tree.** This is how the prior session
trashed the worktree twice and burned an hour in a loop.

Rules that prevent this:
1. Every `write_file`, `patch`, and `read_file` uses an **absolute path**.
   Root: `C:/Users/dalton/StudioProjects/taskman/.worktrees/convert-to-pwa`
   (forward-slash form is fine). Never pass bare `frontend/...` after a
   `terminal cd`.
2. Avoid `cd` in terminal too — use `workdir=` parameter on terminal calls,
   or call commands from the repo root with full relative paths.
3. **Deno on Windows cannot read MSYS paths.** `/c/Users/...` inside Deno code
   (`import.meta.url`, `Deno.env.get("PWD")`, `new URL(...).pathname`) must be
   converted. Conversion function already exists: `toWindowsPath()` at the top
   of `frontend/e2e/e2e.test.ts`. Reuse it — don't re-derive.
4. The `serve.ts` `Deno.stat` must use a **string path**, not a URL object, on
   Windows. The current version passes a URL directly and stat always fails,
   causing the SPA fallback to serve HTML for real files (that's why the
   browser saw `text/html` for `main.js`).

## Current worktree state: what has already been fixed

ROADMAP.md (in this worktree) has been audited and extended:
- Added: PWA phase plan, dead asset alert (`src/assets/hero.png`,
  `src/assets/react.svg`, `public/icons.svg`), missing gitignore entry for
  `ichor/pkg/`, stale-security-cleanups of the "unwrap" and "CI doesn't deploy"
  items.
- Marked **stale**: the ROADMAP's unwrap item (already `.expect()` in
  non-test code) and "document WASM build as deploy prerequisite" claim (the
  workflow already deploys).

`frontend/e2e/` (the folder being started):
- `cdp.ts` — fixed in place to call `Runtime.enable` after attach. Without it,
  `Page.evaluate` silently fails in headless Edge (the page loads but
  `waitForFunction` polls die because the JS eval timer produces no result).
- `e2e.test.ts` — corrected to resolve `PUBLIC` from `../public/` (not
  `../frontend/public/` — that path doubles up `frontend/`) and normalizes to a
  Windows path before passing it on. Test polling logic for localStorage
  added (matches app's 1s debounce in `App.tsx:149`).
- `serve.ts` — the `Deno.stat(URL)` bug is still there (was known broken at
  handoff). When you rewrite it, use a string path:
  ```ts
  const p = new URL(`${rawPath.replace(/\\/$/, "") || "/index.html"}`, root);
  const fsPath = new URL(p).pathname.match(/^\/([A-Za-z]:\/.*)/)?.[1];
  // or: use Deno.realPath / fromFileUrl if available — verify with
  // `deno eval 'console.log(await Deno.stat(new URL("file:///C:/Users/dalton/index.html")))'`
  const stat = await Deno.stat(fsPath ?? p).catch(() => null);
  ```

## E2E behavior currently managed

- **First test exposes a pre-existing app bug**: `main.tsx` does
  `await initWasm()` before mounting React. On first load with no
  `localStorage`, `App.tsx:123` does `fetch(./sample.yaml)`, calls
  `buildGraphFromYaml`, and removes the "Loading#{…}" indicator — but
  `App.tsx:91-93` intentionally skips `saveWorkspace()` for the sample. Then
  `useEffect` at line 145 runs `saveWorkspace(state.yaml)` on every state
  change, so within ~1.1s of `loadYaml` completing, localStorage always has
  the workspace string. The test expectation (`localStorage === sample.yaml`)
  is *correct*, you just have to wait for the polling window (the current
  test's 250ms loop should hit it).
- **Server port randomization works**. The two tests use different port
  numbers (11880, 10056) because `serveStaticDir` uses
  `10000 + Math.floor(Math.random() * 10000)`.
- **Headless Edge launches and attaches successfully** — CDP sessions,
  Target.attachToTarget, Page.navigate all succeed within ~5 seconds on this
  machine. The remaining blocker is the stat-URL bug above.

## PWA implementation plan (agreed in the last chat session)

1. **Phase 1 — Icons/manifest.** Generate 192/512/maskable PNGs from
   `favicon.svg` (Excalidrawn 3-blob on banana `#fffde7`). Use relative
   `start_url: "./"` and `scope: "./"` so it works under the
   `mdsolarflare.github.io/taskman/` subpath without rewrites. No CSP changes
   needed (existing policy already allows `'self'` + `'unsafe-eval'` for
   WASM compilation).
2. **Phase 2 — Service worker.** Hand-rolled zero-dep `public/sw.js`:
   precache `index.html`, `dist/main.js`, `dist/main.css`, `dist/ichor.js`,
   `dist/ichor_bg.wasm`, `sample.yaml`, and the icon set. New build task
   `deno task gen-revision` using `crypto.subtle.digest("SHA-256", bytes)`
   emits `dist/cache-manifest.js` with `{buildId, files}`. SW uses
   `importScripts("./dist/cache-manifest.js")`, IDs caches by `buildId`,
   serves precached on fetch, deletes stale caches on activate. Since
   filenames have no hashes, without this the cache is permanent — this is
   the one design decision you need the current-phase agent to execute
   carefully.
3. **Phase 3 — Install/update UI.** `usePWA` hook (keep with existing
   `useTheme`/`useAutoSave` style): captures `beforeinstallprompt`, exposes
   `canInstall`, `isStandalone`, `waitingToReload`. Add "Install Taskman…" to
   the existing lunch menu dropdown (`App.tsx` around line 490 email context,
   search for `Theme` button to find it), and a "New version ready — Reload"
   toast that calls `skipWaiting()` + `location.reload()`.
4. **Phase 4 — Standalone polish.** `viewport-fit=cover` in `index.html`,
   `safe-area-inset-top` padding on the 48px header (`App.tsx:405-414`), and
   keep `<meta name="theme-color">` synced to `currentColors["--bg-secondary"]`
   — app already has this hook, one `useEffect` listens to `theme`.
5. **Phase 5 — Verify + document.** `deno fmt && deno task lint && deno task
   test` + `cd ichor && cargo fmt && cargo clippy` + e2e tests here in
   `frontend/e2e/`. Add a section to README.md: "PWA", phases 1-3 of the live
   site after install (behaviors Chromium desktop, Edge, macOS Safari), SW
   update semantics, and one line explaining cache delivery. Note the
   `records-pain/` format: Problem → Context → Numbered bugs with diffs →
   Tests added → Takeaways. Match that.

## Validation Before Commit (all must pass)

- `cd frontend && deno fmt && deno task lint && deno test`
- `cd ichor && cargo fmt && cargo clippy --all-targets -- -D warnings`
- `cd frontend/e2e && deno task test` (once stat-URL fix lands)
- The `disable-run` commands above each must return exit code 0.

## Explicit non-goal for the next agent

DO NOT commit or push. Manage all commits yourself. If phases are complete,
leave a clean worktree and let the user inspect/rebase it.

## Note 

Previous agent started having write tool issues. If you have any, stop work and call out the issue.
