import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyTheme, getThemePref } from "./lib/theme";

// Plan 066: before first render so a light user never sees a dark flash.
applyTheme(getThemePref());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
