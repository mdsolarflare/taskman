import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { initWasm } from "./wasm.ts";

// Initialize WASM before rendering so the app is ready on first interaction.
await initWasm();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
