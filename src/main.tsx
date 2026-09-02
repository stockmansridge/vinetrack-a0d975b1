import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import { ThemeProvider } from "./context/ThemeContext";
import { DemoModeProvider } from "./context/DemoModeContext";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <ThemeProvider>
      <DemoModeProvider>
        <App />
      </DemoModeProvider>
    </ThemeProvider>
  </HelmetProvider>,
);
