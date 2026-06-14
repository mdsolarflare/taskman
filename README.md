# Taskman - Tackling Tasks with Graphs

A high-performance, privacy-focused task graph application built with an
**Offline-First** architecture. This is Rust compiled to WebAssembly (WASM),
this project moves heavy computational logic from the server to the client's
browser, ensuring near-native performance and total data ownership.

## Core Dependencies

- deno.com
- rust-lang.org

## 🏗️ Architectural Overview

The project is broken into modules

- **The Brain (`/ichor`):** Written in **Rust**. Handles YAML parsing, graph
  theory calculations, and data processing. Compiled to WASM for browser
  execution. Our goal is near native speed.
- **The Face (`/frontend`):** Built with **React** and **TypeScript**.
  Bundled with **esbuild** via Deno tasks. Styled with inline JavaScript
  style objects for a lightweight, dependency-free approach.
- **The Bridge:** `wasm-bindgen` and `wasm-pack` facilitate the communication
  between Rust logic and the TypeScript frontend.

Our key design imperatives:

- As much idomatic rust as possible
- As simple as possible
- As few dependencies as possible, currently rust, typescript, deno, esbuild, and react. If opportunities arise to aim lower, I will.
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

## 🛠️ Development Setup

### 1. Prerequisites

Install the following toolchains on your system:

**Rust + WASM + deno** (Works on macOS and Linux)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# Install wasm-pack
cargo install wasm-pack

# Install deno
curl -fsSL https://deno.land/install.sh | sh
```

### 1.1 Sanity Check

Verify all tools are installed and on your PATH:

```bash
rustc --version
cargo --version
wasm-pack --version
deno --version
```

If any of these commands fail, double-check your installation before proceeding.

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
deno install
deno lint
deno task test
deno task build
```

### 3. Running the App

Build and serve locally with a static file server:

```bash
# From root
cd frontend && deno task build && deno task serve
```

On first load, the app automatically serves a sample graph from `/sample.yaml`
(see [Sample Data](#-sample-data)). Subsequent visits restore your last
workspace from `localStorage`.

See [`DATA_MODEL.md`](./DATA_MODEL.md) for the complete schema specification.

## 📁 Project Structure

```text
.
├── Sample.yaml              # Reference copy of the sample graph (project root)
├── DATA_MODEL.md            # Full schema spec for Nodes and DAG mapping
├── ichor/                   # Rust WASM project
│   ├── src/                 # YAML parsing, graph builder, layout algorithms
│   └── Cargo.toml           # Rust dependencies & WASM configuration
└── frontend/                # React + esbuild project
    ├── src/                 # UI components and WASM integration glue
    ├── public/              # Static assets served by the file server
    │   └── sample.yaml      # Sample graph auto-loaded on first visit (served at /sample.yaml)
    └── deno.json            # Frontend dependencies (Deno 2)
```

## 🔄 Development Workflow

When making changes to the application:

1. **Modify Logic:** Edit files in `ichor/src/`.
2. **Recompile:** Run `wasm-pack build --release --target web` inside the `/ichor`
   directory.
3. **Update UI:** Modify components in `frontend/src/`.
4. **Rebuild:** Run `deno task build` in `frontend/` to bundle with esbuild,
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

When the File System Access API is unavailable:

- The header shows a **grey status dot** and **disabled toggle** with a
  tooltip explaining the limitation.

If auto-save shows as unsupported in a Chromium browser:

1. Open the browser console and look for the `[autoSave] diagnostics` group.
2. If `showSaveFilePicker: undefined`, check `chrome://flags/#file-system-access-api`.
3. Ensure you're on HTTPS or `localhost` — the API requires a secure context.
4. Firefox and Safari are not yet tested; behavior is unknown.

## 🚀 Deployment

This is a Offline-First app, it can be deployed as a static site on any hosting
provider without the need for a dedicated backend server.

### Guidance for Future Work - Agent Friendly

- Always verify with grep before deleting — confirm the symbol is truly unreferenced.
- Re-run the linter/test suite after every edit batch, not just at the end. `cd frontend && deno fmt && deno task lint && deno test` verifies the frontend. `cd ichor && cargo fmt && cargo check` verifies the ichor module. We should always run these combo steps to verify work and find errors.
- Prefer fixing over silencing — i.e. remove dead code instead adding suppression comments.
- Use idiomatic rust
- Use idiomatic typescript
- **Dual Linting (DO NOT REMOVE):** We use Deno's built-in linter AND ESLint for the frontend project. Both are mandatory and run together via `deno task lint`. Deno lint covers general JS/TS issues (unused vars, unreachable code). ESLint is required specifically for `eslint-plugin-react-hooks` — it catches Rules of Hooks violations and missing `useEffect` dependencies that Deno lint cannot detect. Removing ESLint leaves React-specific bugs undetected.
- **Deno 2 NPM Compatibility (DO NOT REMOVE):** The frontend uses Deno 2's `nodeModulesDir: "auto"` NPM compatibility mode to work with esbuild and React. `frontend/node_modules/` is created automatically by Deno for npm package resolution and is NOT leftover cruft from pnpm — it's required infrastructure. The `deno.json` tasks use `npm:` specifiers (`npm:esbuild`, `npm:eslint`) to run npm binaries. Do not attempt to remove `node_modules/`, switch to pure JSR imports, or otherwise "clean up" NPM compatibility.
