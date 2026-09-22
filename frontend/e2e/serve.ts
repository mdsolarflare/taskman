/**
 * Static file server for e2e tests. Runs in-process (no Docker, no external
 * process). Features:
 *
 *   - SPA fallback: unknown paths serve /index.html (navigation-friendly)
 *   - Correct MIME for .wasm / .js / .css / .yaml / .svg / .png / .webmanifest
 *   - Caches nothing (all real reads each time)
 *   - Closeable alongside test teardown
 */

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".yaml": "text/yaml",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
};

export interface StaticServer {
  url: string;
  close(): Promise<void>;
  /** Root dir as a URL string (resolved once at construction). */
  rootUrl: URL;
}

export function serveStaticDir(rootDir: string): StaticServer {
  // Convert bare paths ending in POSIX drive letters to Windows native format
  // for Deno.file APIs. The incoming rootDir is either:
  //   - "C:/Users/..."          → Native Windows path with fw-slash separators
  //   - "/c/Users/..."          → POSIX-style with drive letter as first seg
  let rootPath = rootDir;
  if (rootPath.startsWith("/")) {
    // "/c/Users/..." → strip the "/c" prefix, use 'C:\Users\...'
    const match = rootPath.match(/^\/([c-z])\/(.*)/i);
    if (match) {
      rootPath = `${match[1].toUpperCase()}:${match[2].replace(/\//g, "\\")}`;
    } else {
      rootPath = rootPath.replace(/\//g, "\\");
    }
  }
  // Normalize all backslash variants to a single Windows-style separator
  rootPath = rootPath.replace(/[/\\]+/g, "\\");

  let closed = false;
  const ac = new AbortController();

  // Use a port in a high, unreserved range so we don't collide with
  // services on common dev ports or ephemeral system ports.
  const port = 10000 + Math.floor(Math.random() * 10000);

  const server = Deno.serve({ hostname: "127.0.0.1", port, signal: ac.signal }, async (req) => {
    if (closed) return new Response("Server closed", { status: 503 });
    const u = new URL(req.url);
    const rawPath = u.pathname;
    const filePath = new URL(
      rawPath.replace(/\/$/, "") || "/index.html",
      root,
    );
    const stat = await Deno.stat(filePath).catch(() => null);
    let body: string | ReadableStream<Uint8Array> | null = null;
    let status = 200;
    let contentType = MIME[
      filePath.pathname.slice(filePath.pathname.lastIndexOf("."))
    ] ?? "application/octet-stream";

    if (!stat?.isFile) {
      if (rawPath === "/sw.js") {
        // Service worker not yet implemented — serve a stub so install
        // readiness can be evaluated before Phase 2, otherwise 404.
        body = "// no-op sw\n";
        contentType = "application/javascript";
      } else if (rawPath !== "/favicon.ico") {
        // SPA fallback — serve index.html.
        body = await Deno.readTextFile(new URL("index.html", root));
        contentType = MIME[".html"];
      } else {
        status = 404;
        body = "Not Found";
      }
    } else {
      const file = await Deno.open(filePath);
      body = file.readable;
    }

    return new Response(body, {
      status,
      headers: {
        "content-type": contentType,
        "cache-control": "no-cache",
      },
    });
  });

  const url = `http://localhost:${server.addr.port}/`;

  const close = async () => {
    closed = true;
    ac.abort();
    await server.finished;
  };

  return {
    url,
    close,
    rootUrl: root,
  };
}
