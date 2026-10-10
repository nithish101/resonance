import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as controller from "./app/controller";
import { useApp } from "./app/store";
import { App } from "./ui/App";
import "./ui/global.css";

// Read-only debug hook for e2e tests and the browser console.
Object.assign(globalThis, { __resonance: { store: useApp, controller } });

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
