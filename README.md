# 🚀 Local-First Graph Engine

A high-performance, privacy-focused graph application built with a **Local-First** architecture. By leveraging Rust compiled to WebAssembly (WASM), this project moves heavy computational logic from the server to the client's browser, ensuring near-native performance and total data ownership.

## 🏗️ Architecture Overview

This project follows a monorepo structure, separating the "Brain" (computation) from the "Face" (interface).

- **The Brain (`/ichor`):** Written in **Rust**. Handles graph theory calculations, parsing, and heavy data processing. Compiled to WASM for browser execution.
- **The Face (`/frontend`):** Built with **React**, **TypeScript**, and **Vite**. Provides a modern UI using **Tailwind CSS** and **Shadcn/UI**.
- **The Bridge:** `wasm-bindgen` and `wasm-pack` facilitate the communication between Rust logic and the TypeScript frontend.

## ✨ Key Features

- 🔒 **Privacy by Design:** Data stays on the user's machine; no backend required for core logic.
- ⚡ **Near-Native Speed:** WASM allows complex graph algorithms to run at speeds impossible with pure JavaScript.
- 📱 **PWA Ready:** Installable as a Progressive Web App for an offline-capable, native-app experience.
- 🎨 **Modern UI:** A clean, responsive interface powered by Tailwind CSS and Shadcn/UI.

## 🛠️ Development Setup

This guide assumes you are running a Linux distribution.

### 1. Prerequisites

Install the following toolchains on your system:

**Rust Toolchain**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

**WASM Pack** (The bridge between Rust and NPM)
```bash
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
```

**Node.js & npm**
Node.js is required to run the project and install `pnpm`. Choose the commands based on your Linux distribution:

**Debian/Ubuntu (apt)**
```bash
sudo apt update
sudo apt install nodejs npm
```

**Arch/CachyOS (pacman)**
```bash
sudo pacman -Syu nodejs npm
```

**Fedora/RHEL (dnf)**
```bash
sudo dnf install nodejs npm
```

**pnpm**
We recommend `pnpm` for faster installations and better disk efficiency.
```bash
sudo npm install -g pnpm
```

### 1.5 Sanity Check (Optional but Recommended)

Before we get into the heavy lifting, let's make sure your Rust toolchain is actually working. This is your "Hello, World!" moment. Run this in a throwaway location:

```bash
cargo new hello-world --bin && cd hello-world && cargo run
```

If you see `Hello, world!` printed to your terminal, you're good to go. If not, double-check your Rust installation before proceeding!

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

## 📁 Project Structure

```text
.
├── ichor/               # Rust WASM project
│   ├── src/            # Logic, algorithms, and data structures
│   └── Cargo.toml      # Rust dependencies & WASM configuration
└── frontend/           # React + Vite project
    ├── src/            # UI components and WASM integration glue
    ├── public/         # Static assets and PWA icons
    └── package.json    # Frontend dependencies
```

## 🔄 Development Workflow

When making changes to the application:

1. **Modify Logic:** Edit files in `ichor/src/`.
2. **Recompile:** Run `wasm-pack build --target web` inside the `/ichor` directory.
3. **Update UI:** Modify components in `frontend/src/`.
4. **Refresh:** The Vite dev server will automatically reflect UI changes; a browser refresh may be needed after updating the WASM binary.

## 🚀 Deployment

Since this is a Local-First app, it can be deployed as a static site on any hosting provider (GitHub Pages, Vercel, Netlify) without the need for a dedicated backend server.
