// @ts-types="npm:vite@^8.0.10"
import { defineConfig } from "vite";
// @ts-types="npm:@vitejs/plugin-react@^6.0.1"
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import fs from "node:fs";

// https://vite.dev/config/
export default defineConfig({
    plugins: [
        react(),
        {
            name: "copy-wasm",
            configResolved() {
                const wasmSrc = resolve(
                    __dirname,
                    "../ichor/pkg/ichor_bg.wasm",
                );
                const wasmDst = resolve(__dirname, "public/ichor_bg.wasm");
                if (fs.existsSync(wasmSrc)) {
                    fs.copyFileSync(wasmSrc, wasmDst);
                }
            },
        },
    ],
    build: {
        target: "esnext",
    },
    resolve: {
        alias: {
            "@": resolve(__dirname, "./src"),
            ichor: resolve(__dirname, "../ichor/pkg/ichor.js"),
        },
    },
});
