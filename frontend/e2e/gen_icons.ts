// One-shot: rasterize favicon.svg into PWA PNG icons via headless Edge canvas.
// Run from frontend/e2e: deno task gen-icons
import { serveStaticDir } from "./serve.ts";

/** Convert a URL pathname (MSYS- or file://-style) to a Windows-native path. */
function toWindowsPath(p: string): string {
  const m = p.match(/^\/([c-z])\/(.*)/i);
  if (m) return `${m[1].toUpperCase()}:${m[2].replace(/\//g, "\\")}`;
  const w = p.match(/^\/([a-z]):\/(.*)/i);
  if (w) return `${w[1].toUpperCase()}:\\${w[2].replace(/\//g, "\\")}`;
  return p;
}

const PUBLIC = toWindowsPath(new URL("../public/", import.meta.url).pathname);

const server = serveStaticDir(PUBLIC);

// Launch Edge headless (flags only — never pass a URL)
const stamp = Date.now();
const localAppData = Deno.env.get("LOCALAPPDATA") ??
  `C:\\Users\\${Deno.env.get("USERNAME")}\\AppData\\Local`;
const profileDir = `${localAppData}\\taskman-icon-gen-${stamp}`;
const port = 9500 + Math.floor(Math.random() * 400);
const proc = new Deno.Command(
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  {
    args: [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      "--headless=new",
      "--no-first-run",
    ],
    stdout: "null",
    stderr: "piped",
  },
).spawn();

let wsUrl = "";
for (let i = 0; i < 75; i++) {
  await new Promise((r) => setTimeout(r, 400));
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (res.ok) {
      const info = await res.json();
      wsUrl = info.webSocketDebuggerUrl;
      break;
    }
  } catch { /* keep polling */ }
}
if (!wsUrl) {
  proc.kill();
  throw new Error("Edge debug port never came up");
}

// Minimal CDP over raw WebSocket (same shape as cdp.ts)
const sock = new WebSocket(wsUrl);
await new Promise<void>((res, rej) => {
  sock.onopen = () => res();
  sock.onerror = (e) => rej(new Error(`WS open failed: ${String(e)}`));
});
let nextId = 1;
const pending = new Map<number, (msg: unknown) => void>();
sock.onmessage = (e) => {
  const m = JSON.parse(e.data as string) as {
    id?: number;
    result?: unknown;
    error?: { message: string };
  };
  if (m.id !== undefined) {
    const res = pending.get(m.id);
    if (res) {
      pending.delete(m.id);
      res(m);
    }
  }
};
let activeSessionId: string | undefined;
function send(method: string, params?: Record<string, unknown>) {
  const id = nextId++;
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    pending.set(id, (m) => {
      if (m.error) reject(new Error(`${method}: ${m.error.message}`));
      else resolve(m.result as Record<string, unknown>);
    });
    const msg: Record<string, unknown> = { id, method };
    if (params) msg.params = params;
    if (activeSessionId !== undefined) msg.sessionId = activeSessionId;
    sock.send(JSON.stringify(msg));
  });
}

const { targetId } = await send("Target.createTarget", {
  url: "about:blank",
}) as { targetId: string };
const { sessionId } = await send("Target.attachToTarget", {
  targetId,
  flatten: true,
}) as { sessionId: string };
activeSessionId = sessionId;
await send("Runtime.enable");
await send("Page.enable");

// Navigate to the served origin first — evaluating on about:blank (null
// origin) makes same-origin http images "cross-origin" and taints the
// canvas, so toDataURL() throws SecurityError.
await send("Page.navigate", { url: server.url });
await new Promise((r) => setTimeout(r, 1000));

// Serve favicon over http so the canvas isn't tainted; draw + export PNGs
const expr = `(async () => {
  const img = new Image();
  img.src = ${JSON.stringify(`${server.url}favicon.svg`)};
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
  const BG = "#fffde7";
  function draw(size, maskable) {
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const x = c.getContext("2d");
    x.fillStyle = BG; x.fillRect(0, 0, size, size);
    const inset = maskable ? size * 0.10 : 0;
    const box = size - 2 * inset;
    const s = Math.min(box / img.width, box / img.height);
    const w = img.width * s, h = img.height * s;
    x.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    return c.toDataURL("image/png");
  }
  return {
    "icon-192.png": draw(192, false),
    "icon-512.png": draw(512, false),
    "icon-512-maskable.png": draw(512, true),
    "apple-touch-icon.png": draw(180, false),
  };
})()`;

const r = await send("Runtime.evaluate", {
  expression: expr,
  returnByValue: true,
  awaitPromise: true,
}) as Record<string, unknown>;
console.log("RAW RESULT:", JSON.stringify(r, null, 2).slice(0, 2000));
const icons = (r.result as { value: Record<string, string> }).value;
console.log("eval result keys:", Object.keys(icons ?? {}));
if (!icons || Object.keys(icons).length === 0) {
  throw new Error("Canvas eval returned no icons");
}
const outDir = `${PUBLIC}/icons`;
await Deno.mkdir(outDir, { recursive: true });
for (const [name, dataurl] of Object.entries(icons)) {
  const b64 = dataurl.split(",", 2)[1];
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  await Deno.writeFile(`${outDir}/${name}`, bytes);
  console.log(`${name}: ${bytes.length} bytes`);
}

await send("Target.closeTarget", { targetId }).catch(() => {});
sock.close();
proc.kill();
await server.close();
console.log("DONE");
