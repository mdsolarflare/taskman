/**
 * Static file server for e2e tests (also reused by the dev `pnpm run serve`
 * entry - one implementation, no second server). Runs in-process (no
 * external process). Features:
 *
 *   - SPA fallback: unknown paths serve /index.html (navigation-friendly)
 *   - Correct MIME for .wasm / .js / .css / .yaml / .svg / .png / .webmanifest
 *   - Caches nothing (all real reads each time)
 *   - Closeable alongside test teardown
 *   - Optional offline mode: after `goOffline()`, all requests fail (used by
 *     the offline-reload e2e test to prove the service worker serves the shell)
 */

import { createServer, type Server } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
  ".wasm": "application/wasm",
};

export interface StaticServer {
  url: string;
  close(): Promise<void>;
  /** Root dir as a URL string (resolved once at construction). */
  rootUrl: URL;
  /** Fail every request from now on, simulating network loss. */
  goOffline(): void;
}

export function serveStaticDir(
  rootDir: string,
  opts: { port?: number; onError?: (err: Error) => void } = {},
): StaticServer {
  // Convert incoming path forms to a Windows-native absolute path. Accepts
  // POSIX-style (/c/Users/...), forward-slash Windows (C:/Users/...), or
  // backslash Windows paths.
  let rootPath = rootDir;
  if (rootPath.startsWith("/")) {
    // "/c/Users/..." → "C:\Users\..."
    const match = rootPath.match(/^\/([c-z])\/(.*)/i);
    if (match) {
      rootPath = `${match[1].toUpperCase()}:${match[2].replace(/\//g, "\\")}`;
    } else {
      rootPath = rootPath.replace(/\//g, "\\");
    }
  }
  // Normalize to forward slashes, collapse duplicates, strip trailing slash
  rootPath = rootPath.replace(/[\\/]+/g, "/").replace(/\/+$/, "");

  const root = new URL(`file:///${rootPath}/`);

  let closed = false;
  let offline = false;

  // Use a fixed port when requested (the dev serve entry needs a stable
  // origin - browser storage is host:port-scoped), or a random port in a
  // high, unreserved range so parallel e2e runs never collide.
  const port = opts.port ?? 10000 + Math.floor(Math.random() * 10000);

  const server: Server = createServer(async (req, res) => {
    try {
      if (closed) {
        res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
        res.end("Server closed");
        return;
      }
      if (offline) {
        res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
        res.end("Network error (offline simulation)");
        return;
      }

      const u = new URL(req.url ?? "/", "http://127.0.0.1/");
      const rawPath = u.pathname;
      // Decode percent-escapes and strip leading slashes, then join via
      // plain string concatenation - never `new URL(rel, root)`: on Windows
      // any rel starting with "/" resolves against the file:// origin and
      // discards the base directory, so every stat fails and the SPA
      // fallback serves index.html for real files.
      const relPath = decodeURIComponent(rawPath).replace(/^\/+/, "");
      if (relPath.includes("..")) {
        res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
        res.end("Forbidden");
        return;
      }
      const fsPath =
        relPath === "" ? `${rootPath}/index.html` : `${rootPath}/${relPath}`;

      const st = await stat(fsPath).catch(() => null);
      const ext = fsPath.slice(fsPath.lastIndexOf(".")).toLowerCase();
      const contentType = MIME[ext] ?? "application/octet-stream";

      if (!st?.isFile) {
        if (rawPath === "/favicon.ico") {
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          res.end("Not Found");
        } else {
          // SPA fallback - serve index.html.
          const body = await readFile(`${rootPath}/index.html`, "utf8").catch(
            () => "Not Found",
          );
          res.writeHead(200, {
            "content-type": MIME[".html"],
            "cache-control": "no-cache",
          });
          res.end(body);
        }
        return;
      }

      // Stream the file. Gate on "open" so a file that vanishes between
      // stat and open still yields a clean 404 (mirrors the old
      // open-then-404 behavior); errors mid-stream destroy the response
      // since headers are already sent.
      const stream = createReadStream(fsPath);
      stream.on("error", () => {
        if (res.headersSent) res.destroy();
        else {
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          res.end("Not Found");
        }
      });
      stream.on("open", () => {
        res.writeHead(200, {
          "content-type": contentType,
          "cache-control": "no-cache",
        });
        stream.pipe(res);
      });
    } catch {
      res.destroy();
    }
  });

  // Surface listen errors (e.g. EADDRINUSE) to the caller when requested;
  // without a handler Node treats them as uncaught exceptions.
  if (opts.onError) server.on("error", opts.onError);

  server.listen(port, "127.0.0.1");

  const url = `http://127.0.0.1:${port}/`;

  const close = async () => {
    closed = true;
    await new Promise<void>((resolve) => {
      // Force-close open sockets - keep-alive browser connections would
      // otherwise hold the listener open past test teardown.
      server.closeAllConnections();
      server.close(() => resolve());
    });
  };

  return {
    url,
    close,
    rootUrl: root,
    goOffline: () => {
      offline = true;
    },
  };
}
