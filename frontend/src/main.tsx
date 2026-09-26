import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { initWasm } from "./wasm.ts";

// Initialize WASM before rendering so the app is ready on first interaction.
await initWasm();

// Register the service worker (PWA shell caching + offline support).
// updateViaCache: "none" so the browser always revalidates sw.js itself —
// otherwise an HTTP-cached sw.js could pin the app to an old build.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", {
    scope: "./",
    updateViaCache: "none",
  }).catch((err) =>
    console.warn("[pwa] service worker registration failed:", err)
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
