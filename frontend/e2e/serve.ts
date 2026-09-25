/**
 * Static file server for e2e tests. Runs in-process (no external process).
 * Features:
 *
 *   - SPA fallback: unknown paths serve /index.html (navigation-friendly)
 *   - Correct MIME for .wasm / .js / .css / .yaml / .svg / .png / .webmanifest
 *   - Caches nothing (all real reads each time)
 *   - Closeable alongside test teardown
 *   - Optional offline mode: after `goOffline()`, all requests fail (used by
 *     the offline-reload e2e test to prove the service worker serves the shell)
 */

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

export function serveStaticDir(rootDir: string): StaticServer {
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
  const ac = new AbortController();

  // Use a port in a high, unreserved range so we don't collide with
  // services on common dev ports or ephemeral system ports.
  const port = 10000 + Math.floor(Math.random() * 10000);

  const server = Deno.serve(
    { hostname: "127.0.0.1", port, signal: ac.signal },
    async (req) => {
      if (closed) return new Response("Server closed", { status: 503 });
      if (offline) {
        return new Response("Network error (offline simulation)", {
          status: 503,
        });
      }

      const u = new URL(req.url);
      const rawPath = u.pathname;
      // Decode percent-escapes and strip leading slashes, then join via
      // plain string concatenation — never `new URL(rel, root)`: on Windows
      // any rel starting with "/" resolves against the file:// origin and
      // discards the base directory, so every stat fails and the SPA
      // fallback serves index.html for real files.
      const relPath = decodeURIComponent(rawPath).replace(/^\/+/, "");
      if (relPath.includes("..")) {
        return new Response("Forbidden", { status: 403 });
      }
      const fsPath = relPath === ""
        ? `${rootPath}/index.html`
        : `${rootPath}/${relPath}`;

      const stat = await Deno.stat(fsPath).catch(() => null);
      let status = 200;
      const ext = fsPath.slice(fsPath.lastIndexOf(".")).toLowerCase();
      let contentType = MIME[ext] ?? "application/octet-stream";
      let body: string | ReadableStream<Uint8Array> | null;

      if (!stat?.isFile) {
        if (rawPath === "/favicon.ico") {
          status = 404;
          body = "Not Found";
        } else {
          // SPA fallback — serve index.html.
          body = await Deno.readTextFile(`${rootPath}/index.html`).catch(
            () => "Not Found",
          );
          contentType = MIME[".html"];
        }
      } else {
        const file = await Deno.open(fsPath).catch(() => null);
        if (!file) return new Response("Not Found", { status: 404 });
        body = file.readable;
      }

      return new Response(body, {
        status,
        headers: {
          "content-type": contentType,
          "cache-control": "no-cache",
        },
      });
    },
  );

  const url = `http://127.0.0.1:${server.addr.port}/`;

  const close = async () => {
    closed = true;
    ac.abort();
    await server.finished;
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
