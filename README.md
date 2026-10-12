# Taskman - Tackling Tasks with Graphs

A high-performance, privacy-focused task graph application built with an
**Offline-First** architecture. This is Rust compiled to WebAssembly (WASM),
this project moves heavy computational logic from the server to the client's
browser, ensuring near-native performance and total data ownership.

## Core Dependencies

- nodejs.org (managed with pnpm — pnpm.io)
- rust-lang.org

## 🏗️ Architectural Overview

The project is broken into modules

- **The Brain (`/ichor`):** Written in **Rust**. Handles YAML parsing, graph
  theory calculations, and data processing. Compiled to WASM for browser
  execution. Our goal is near native speed.
- **The Face (`/frontend`):** Built with **React** and **TypeScript**.
  Bundled with **esbuild** via pnpm scripts. Styled with inline JavaScript
  style objects for a lightweight, dependency-free approach.
- **The Bridge:** `wasm-bindgen` and `wasm-pack` facilitate the communication
  between Rust logic and the TypeScript frontend.

Our key design imperatives:

- As much idomatic rust as possible
- As simple as possible
- As few dependencies as possible, currently rust, typescript, node/pnpm, esbuild, and react. If opportunities arise to aim lower, I will.
- Minimal design, highly opinionated styling

## ✨ Key Features

- 🔒 **Privacy by Design:** Data stays on the user's machine; no backend
  required.
- ⚡ **Near-Native Speed:** WASM allows complex graph algorithms to run at
  speeds impossible with pure JavaScript.
- 💾 **Auto-Save to Local Files:** Changes are automatically written to disk
  after each completed edit. Uses the File System Access API with IndexedDB
  handle persistence so your file association survives browser reloads.
  Works on Chromium-based browsers (Chrome, Edge, Brave); see
  [Auto-Save](#-auto-save) for requirements and fallbacks.
- 📋 **Sample Data:** First-time users get a sample graph demonstrating the full
  data model hierarchy (parent nodes, leaf nodes, nesting).
- 🎨 **Fast UI:** A clean, responsive interface using inline styles for a
  lightweight, zero-dependency frontend.
- 📱 **Installable PWA:** Works offline after the first visit — the whole
  shell (including the WASM brain) is precached by a zero-dependency service
  worker with build-time cache revisioning. See
  [Installing Taskman as an App](./docs/PWA.md).

## 🛠️ Development Setup

### 1. Prerequisites

Install the following toolchains on your system:

**Rust + WASM + Node (managed via pnpm)** (Works on macOS and Linux)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# Install wasm-pack
cargo install wasm-pack

# Install pnpm (brings its own managed Node; or install Node yourself
# and run: corepack enable)
curl -fsSL https://get.pnpm.io/install.sh | sh -
```

### 1.1 Sanity Check

Verify all tools are installed and on your PATH:

```bash
rustc --version
cargo --version
wasm-pack --version
node --version
pnpm --version
```

If any of these commands fail, double-check your installation before proceeding.

This project pins exact toolchain versions for reproducible builds: Rust
`1.95.0` (via `rust-toolchain.toml`, rustup switches to it automatically),
pnpm `12.11.2` + Node `26.7.0` (pinned via the `packageManager` field and
CI) and wasm-pack `0.15.0` (pinned in the CI workflows). All dependency
versions are pinned exactly in `frontend/package.json` /
`pnpm-lock.yaml` and `ichor/Cargo.toml` — no caret/tilde ranges — so
refreshing dependencies is a no-op unless a pin is deliberately changed.

### 2. Installation & Build Process

#### Step A: Build the Rust Ichor

First, we need to compile the Rust logic into a WASM package that the frontend
can import.

```bash
# From root
cargo check --manifest-path ichor/Cargo.toml
cargo build --verbose --manifest-path ichor/Cargo.toml
cargo test --verbose --manifest-path ichor/Cargo.toml
wasm-pack build --release --target web
```

#### Step B: Build up the Frontend

Now, install dependencies, lint, test, and build the frontend.

```bash
# From root
cd frontend
pnpm install
pnpm lint
pnpm test
pnpm build
```

### 3. Running the App

Build and serve locally with a static file server:

```bash
# From root
cd frontend && pnpm build && pnpm serve
```

On first load, the app automatically serves a sample graph from `/sample.yaml`
(see [Sample Data](#-sample-data)). Subsequent visits restore your last
workspace from `localStorage`.

See [`DATA_MODEL.md`](./docs/DATA_MODEL.md) for the complete schema specification.

## 📁 Project Structure

```text
.
├── AGENTS.md                # Agent working rules (principles + verification gates)
├── ROADMAP.md               # Roadmap + audit findings log
├── docs/                    # DATA_MODEL.md, PWA.md, DECISION-*.md, records-pain/
├── ichor/                   # Rust WASM project
│   ├── src/                 # YAML parsing, graph builder, layout algorithms
│   └── Cargo.toml           # Rust dependencies & WASM configuration
└── frontend/                # React + esbuild project
    ├── src/                 # UI components and WASM integration glue
    ├── e2e/                 # CDP-driven browser e2e harness (own scripts, outside tsconfig)
    ├── gen-revision.ts       # Build step: hashes shell, stamps SW BUILD_ID
    ├── public/              # Static assets served by the file server
    │   ├── sample.yaml      # Sample graph auto-loaded on first visit (served at /sample.yaml)
    │   ├── icons/           # Committed PWA icons (regen: pnpm gen-icons)
    │   ├── manifest.webmanifest
    │   └── sw.js            # Hand-rolled service worker (see docs/DECISION-sw-revisioning.md)
    └── package.json         # Frontend dependencies (pnpm workspace package)
```

## 🔄 Development Workflow

When making changes to the application:

1. **Modify Logic:** Edit files in `ichor/src/`.
2. **Recompile:** Run `wasm-pack build --release --target web` inside the `/ichor`
   directory.
3. **Update UI:** Modify components in `frontend/src/`.
4. **Rebuild:** Run `pnpm build` in `frontend/` to bundle with esbuild,
   then refresh the browser.

## 💾 Auto-Save

In supported browsers, Taskman can write changes to disk automatically after each completed node edit, creation, or deletion. A debounce prevents excessive writes while keeping your local file current.

### How It Works

1. **File Tracking** — Open and Save As dialogs trigger a native file picker via 
   the File System Access API. The chosen file handle is persisted in IndexedDB so 
   it survives browser reloads.
2. **Session Restore** — On mount, Taskman restores the handle from IndexedDB,
   re-requests write permission if needed, and resumes auto-save.

### Browser Requirements

| Browser | Auto-Save | Notes |
|---|---|---|
| Chrome, Edge, Brave | ✅ | Requires **secure context** (HTTPS or `localhost`). Chrome Dev/Canary builds may need `chrome://flags/#file-system-access-api` enabled. |
| Firefox | ⚠️ | Not yet tested.. |
| Safari | ⚠️ | Not yet tested.. |

### Troubleshooting

When the File System Access API is unavailable, the status dot is grey and
the toggle is disabled. Hover it — the tooltip names the exact cause and
the fix. The three causes and their remedies:

| Cause | Meaning | Fix |
|---|---|---|
| Insecure context | Page opened over plain `http://` at a non-localhost host (e.g. `127.0.0.1`, a LAN IP) | Open the app at `http://localhost:<port>` (localhost counts as a secure context) or serve over HTTPS |
| Chromium flags/version | Chromium-based browser without the API exposed | Check `chrome://flags/#file-system-access-api` (Edge: `edge://flags`) or update the browser |
| Browser unsupported | Firefox / Safari (no File System Access API) | Save As falls back to a plain download; auto-save to a tracked file is unavailable |

Auto-save state is **origin-scoped** (browser storage is keyed by
`host:port`): the file-handle association lives in IndexedDB and the
workspace in localStorage, each under the exact origin you opened.
`http://localhost:8000` and `http://127.0.0.1:8000` are **different
origins** — a handle linked at one is invisible at the other. The console
logs `[autoSave]` diagnostics on every boot, including the origin being
used; if a handle is missing, the log says which origin was checked.

Deep-dive checklist, if the tooltip alone isn't enough:

1. Open the browser console and look for the `[autoSave] diagnostics` group.
2. If `showSaveFilePicker: undefined`, check `chrome://flags/#file-system-access-api`.
3. Ensure you're on HTTPS or `localhost` — the API requires a secure context.
4. Firefox and Safari are not yet tested; behavior is unknown.

## 📱 PWA — Install Taskman

Taskman is an installable Progressive Web App. After the first visit, the
entire app shell — HTML, JS, CSS, the Rust/WASM binary, the sample data, and
icons — is precached by a service worker, so it boots with no network at all.
Once installed it opens in its own window (no browser chrome), and the
system title bar / taskbar swatch follows the active theme via
`<meta name="theme-color">`.

**Installing, offline behavior, update semantics, and icon regeneration:
see [Installing Taskman as an App](./docs/PWA.md).**

## 🚀 Deployment

This is an Offline-First app that deploys as a static site — no backend server
required. The build outputs self-contained HTML, CSS, JS, and WASM to
`frontend/public/`, ready for any static host.

### Deploying to GitHub Pages

A GitHub Actions workflow (`.github/workflows/static.yml`) builds and deploys
automatically on every push to `main`:

1. **Enable Pages:** In your repo, go to **Settings → Pages**.
2. **Set source:** Under "Build and deployment" → "Source", select **GitHub Actions**.
3. **Push to `main`:** The workflow runs automatically — it builds the Rust WASM
   brain, bundles the frontend, and uploads `frontend/public/` as a Pages artifact.
4. **Access your app:**
   - User/org repo: `https://<username>.github.io/<repo-name>/`
   - Project site (`gh-pages` branch): `https://<username>.github.io/`

The workflow handles the full build pipeline:
```
Rust → wasm-pack → WASM bundle
         ↓
TypeScript → esbuild → JS/CSS bundle
         ↓
All assets vendored into frontend/public/dist/
         ↓
Uploaded to GitHub Pages
```

**Manual trigger:** You can also run the workflow on demand from the **Actions**
tab → "Deploy static content to Pages" → **Run workflow**.

### Other Static Hosts

Build locally and upload `frontend/public/` to any static host (Netlify,
Vercel, Cloudflare Pages, S3 + CloudFront, etc.):

```bash
cd frontend && pnpm build
# Serve the contents of frontend/public/
```

### Guidance for Future Work - Agent Friendly

- Always verify with grep before deleting — confirm the symbol is truly unreferenced.
- Re-run the linter/test suite after every edit batch, not just at the end. `cd frontend && pnpm fmt && pnpm lint && pnpm test` verifies the frontend. `cd ichor && cargo fmt && cargo check` verifies the ichor module. We should always run these combo steps to verify work and find errors.
- The full gate before committing also runs the browser e2e suite: `pnpm --dir frontend test:e2e` (headless Edge via CDP; boots the app, checks localStorage persistence, and proves the service worker precaches the shell and serves it offline).
- Prefer fixing over silencing — i.e. remove dead code instead adding suppression comments.
- Use idiomatic rust
- Use idiomatic typescript
- **ESLint-only Linting (DO NOT REMOVE):** The frontend is linted by ESLint (with `@typescript-eslint` and `eslint-plugin-react-hooks`). This was a deliberate simplification in the 2026-10-11 Deno→pnpm migration, which dropped the Deno built-in linter that previously ran alongside ESLint. Net delta: general JS/TS issues (unused vars, unreachable code) are now covered by `@typescript-eslint`'s recommended rules instead of deno-lint; ESLint remains mandatory specifically for `eslint-plugin-react-hooks` — it catches Rules of Hooks violations and missing `useEffect` dependencies. Removing ESLint leaves React-specific bugs undetected.
- **pnpm-Managed node_modules (DO NOT REMOVE):** The frontend is a pnpm workspace package (`pnpm-workspace.yaml` at the repo root); dependencies are installed into `frontend/node_modules/` by pnpm from `pnpm-lock.yaml`. The directory is required infrastructure, NOT leftover cruft — do not attempt to remove `node_modules/` or "clean up" the pnpm setup. CI installs with `pnpm install --frozen-lockfile`.
