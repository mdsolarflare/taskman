# 🚀 Taskman — Local-First Graph Engine

A high-performance, privacy-focused task graph application built with a **Offline-First** architecture. This is Rust compiled to WebAssembly (WASM), this project moves heavy computational logic from the server to the client's browser, ensuring near-native performance and total data ownership.

## 🏗️ Architecture Overview

This project follows a monorepo structure, separating the "Brain" (computation) from the "Face" (interface).

- **The Brain (`/ichor`):** Written in **Rust**. Handles YAML parsing, graph theory calculations, and heavy data processing. Compiled to WASM for browser execution.
- **The Face (`/frontend`):** Built with **React**, **TypeScript**, and **Vite**. Styled with inline JavaScript style objects for a lightweight, dependency-free approach.
- **The Bridge:** `wasm-bindgen` and `wasm-pack` facilitate the communication between Rust logic and the TypeScript frontend.

## ✨ Key Features

- 🔒 **Privacy by Design:** Data stays on the user's machine; no backend required.
- ⚡ **Near-Native Speed:** WASM allows complex graph algorithms to run at speeds impossible with pure JavaScript.
- 💾 **Persistent Workspace:** Your YAML workspace is saved to `localStorage` and restored automatically on return visits.
- 📋 **Sample Data:** First-time users get a sample graph demonstrating the full data model hierarchy (parent nodes, leaf nodes, nesting).
- 🎨 **Modern UI:** A clean, responsive interface using inline styles for a lightweight, zero-dependency frontend.

## 🛠️ Development Setup

### 1. Prerequisites

Install the following toolchains on your system:

**Rust + WASM** (Works on macOS and Linux)
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# Install wasm-pack
cargo install wasm-pack
```

**Node.js & npm** (Pick your package manager)
```bash
# macOS (Homebrew)
brew install nodejs

# Debian/Ubuntu
sudo apt update && sudo apt install nodejs npm

# Arch/CachyOS
sudo pacman -Syu nodejs npm

# Fedora/RHEL
sudo dnf install nodejs npm
```

**pnpm** (Works on macOS and Linux)
```bash
npm install -g pnpm
```

### 1.5 Sanity Check

Verify all tools are installed and on your PATH:

```bash
rustc --version
cargo --version
wasm-pack --version
node --version
npm --version
pnpm --version
```

If any of these commands fail, double-check your installation before proceeding.


### 2. Installation & Build Process

#### Step A: Build the Rust Ichor
First, we need to compile the Rust logic into a WASM package that the frontend can import.

```bash
cd ichor
wasm-pack build --target web
```

#### Step B: Set up the Frontend
Now, initialize the React environment and link it to the compiled WASM package.

```bash
cd ../frontend
pnpm install
# Link the local Rust package
pnpm add ../ichor/pkg
```

### 3. Running the App

To start the development server with Hot Module Replacement (HMR):

```bash
cd frontend
pnpm dev
```

On first load, the app automatically serves a sample graph from `/sample.yaml` (see [Sample Data](#-sample-data)). Subsequent visits restore your last workspace from `localStorage`.

## 📁 Project Structure

```text
.
├── Sample.yaml              # Reference copy of the 4-node sample graph (project root)
├── DATA_MODEL.md            # Full schema spec for Nodes and DAG mapping
├── ichor/                   # Rust WASM project
│   ├── src/                 # YAML parsing, graph builder, layout algorithms
│   └── Cargo.toml           # Rust dependencies & WASM configuration
└── frontend/                # React + Vite project
    ├── src/                 # UI components and WASM integration glue
    ├── public/              # Static assets served by the dev server
    │   └── sample.yaml      # Sample graph auto-loaded on first visit (served at /sample.yaml)
    └── package.json         # Frontend dependencies
```

## 📋 Sample Data

The app ships with a 4-node sample graph demonstrating the full data model:

- **Location:** `frontend/public/sample.yaml` (served at `/sample.yaml`) and `Sample.yaml` (project root reference)
- **Structure:**
  ```
  [1] Build Taskman App          → Root Node (all fields: details, important, subtask_ids)
  ├── [2] Implement Rust Core    → Child of [1], also a parent with child [3] (nesting demo)
  │   └── [3] Compile to WASM    → Leaf Node (minimal: id, name, deadline only)
  └── [4] Design Frontend UI     → Leaf Node (minimal)
  ```
- **Key concepts illustrated:** Roots vs children, parents with subtask_ids, leaf nodes, and DAG nesting

See [`DATA_MODEL.md`](./DATA_MODEL.md) for the complete schema specification.

## 🔄 Development Workflow

When making changes to the application:

1. **Modify Logic:** Edit files in `ichor/src/`.
2. **Recompile:** Run `wasm-pack build --target web` inside the `/ichor` directory.
3. **Update UI:** Modify components in `frontend/src/`.
4. **Refresh:** The Vite dev server will automatically reflect UI changes; a browser refresh may be needed after updating the WASM binary.

## 🚀 Deployment

Since this is a Local-First app, it can be deployed as a static site on any hosting provider (GitHub Pages, Vercel, Netlify) without the need for a dedicated backend server.
