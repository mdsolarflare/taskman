import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import fs from "fs";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "copy-wasm",
      configResolved() {
        const wasmSrc = resolve(__dirname, "../ichor/pkg/ichor_bg.wasm");
        const wasmDst = resolve(__dirname, "public/ichor_bg.wasm");
        if (fs.existsSync(wasmSrc)) {
          fs.copyFileSync(wasmSrc, wasmDst);
        }
      },
    },
  ],
  experiments: {
    asyncWebAssembly: true,
  },
  build: {
    target: "esnext",
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
