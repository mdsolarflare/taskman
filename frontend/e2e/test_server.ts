import { serveStaticDir } from "./serve.ts";

const server = serveStaticDir("/c/Users/dalton/StudioProjects/taskman/.worktrees/convert-to-pwa/frontend/public");
console.log("Server URL:", server.url);

// Give server time to start, then try hitting it manually
await new Promise(r => setTimeout(r, 200));
try {
  const res = await fetch("http://127.0.0.1:" + server.url.split(":").pop() + "/index.html");
  console.log("Fetch /index.html:", res.status);
  const text = await res.text();
  console.log("Response body:", text.substring(0, 100));
} catch (err) {
  console.log("Fetch failed:", err.message);
}
await server.close();
