/**
 * Dev static server - reuses the e2e harness's server (one implementation,
 * zero extra dependencies). Run from frontend/: `pnpm run serve`.
 *
 * The node:http server keeps the process alive; Ctrl+C to stop.
 *
 * Port: default 8000. Override with `--port 3000` or TASKMAN_PORT=3000.
 * The port is NOT cosmetic: browser storage (the auto-save file handle in
 * IndexedDB, the workspace in localStorage) is scoped to the ORIGIN
 * (host:port), so switching ports starts a fresh storage sandbox - your
 * auto-save file association and workspace will not follow. Pick one port
 * and stay on it. 8000 matches the pre-pnpm `deno task serve` (std
 * file-server default), so state saved back then reappears at
 * http://localhost:8000/.
 */

import { serveStaticDir } from "./e2e/serve.ts";

/**
 * Convert a URL pathname (file://-style) to a Windows-native path.
 * Written without literal backslashes (String.fromCharCode(92)) so no
 * editor/transcript layer can mangle the escapes - semantics identical to
 * the same helper in e2e/test_server.ts.
 */
const BS = String.fromCharCode(92); // backslash
const MSYS_PATH = new RegExp("^/([c-z])/(.*)", "i");
const URL_DRIVE_PATH = new RegExp("^/([a-z]):/(.*)", "i");

function toWindowsPath(p: string): string {
  // /c/Users/x/... → C:\Users\x\...   (MSYS/git-bash form)
  const m = p.match(MSYS_PATH);
  if (m) {
    return `${m[1].toUpperCase()}:${m[2].split("/").join(BS)}`;
  }
  // /C:/Users/x/... → C:\Users\x\... (URL.pathname form - the leading
  // slash is an artifact of URL.pathname, not a real path segment)
  const w = p.match(URL_DRIVE_PATH);
  if (w) {
    return `${w[1].toUpperCase()}:${BS}${w[2].split("/").join(BS)}`;
  }
  return p;
}

const root = toWindowsPath(new URL("./public/", import.meta.url).pathname);

// --port NNNN flag or TASKMAN_PORT env; default 8000 (see header comment
// for why the port must be stable per dev machine).
const flagIdx = process.argv.indexOf("--port");
const portArg = flagIdx !== -1 ? process.argv[flagIdx + 1] : undefined;
const port = Number(portArg ?? process.env.TASKMAN_PORT ?? 8000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid port: ${portArg ?? process.env.TASKMAN_PORT}`);
  process.exit(1);
}

serveStaticDir(root, {
  port,
  onError: (err) => {
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
      console.error(`\nPort ${port} is already in use by another process.`);
      console.error(
        `Taskman's browser storage (auto-save handle + workspace) is scoped to the ORIGIN,`,
      );
      console.error(
        `so a stable port matters. Either stop the other process, or pick a different port -`,
      );
      console.error(
        `but note: a NEW port means a NEW storage sandbox (your auto-save file`,
      );
      console.error(
        `association will not follow you there). To retry on another port:`,
      );
      console.error(`  pnpm run serve -- --port 8080`);
      console.error(`  (or: TASKMAN_PORT=8080 pnpm run serve)\n`);
    } else {
      console.error("Server error:", err);
    }
    process.exit(1);
  },
});

console.log(`Serving ${root}`);
console.log(`  → http://localhost:${port}/`);
console.log(
  `  (open localhost, not 127.0.0.1 - storage is origin-scoped and the two are different origins)`,
);
