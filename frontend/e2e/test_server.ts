/**
 * Smoke script: start the static server and probe a few paths.
 * Run from frontend/e2e: deno run --no-check --allow-net=127.0.0.1 --allow-env --allow-read=../public test_server.ts
 */

import { serveStaticDir } from "./serve.ts";

function toWindowsPath(p: string): string {
  const m = p.match(/^\/([c-z])\/(.*)/i);
  if (m) return `${m[1].toUpperCase()}:${m[2].replace(/\//g, "\\")}`;
  const w = p.match(/^\/([a-z]):\/(.*)/i);
  if (w) return `${w[1].toUpperCase()}:\\${w[2].replace(/\//g, "\\")}`;
  return p;
}

const PUBLIC = toWindowsPath(new URL("../public/", import.meta.url).pathname);

const server = serveStaticDir(PUBLIC);
console.log("rootUrl:", server.rootUrl.pathname);
console.log("Server URL:", server.url);

for (
  const p of [
    "index.html",
    "dist/main.js",
    "dist/main.css",
    "dist/ichor_bg.wasm",
    "dist/cache-manifest.js",
    "sample.yaml",
    "sw.js",
    "manifest.webmanifest",
    "icons/icon-192.png",
  ]
) {
  const res = await fetch(`${server.url}${p}`);
  console.log(
    `GET /${p} →`,
    res.status,
    `(${res.headers.get("content-type")})`,
  );
}
await server.close();
