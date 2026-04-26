import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";

if (import.meta.env.PROD) {
  const build = document.querySelector("meta[name='rexalgo-build']")?.getAttribute("content");
  if (build) console.info("[RexAlgo] UI build:", build);
}

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>
);
