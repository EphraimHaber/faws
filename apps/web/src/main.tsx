import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ScopeProvider } from "~/contexts/ScopeContext";
import { ThemeProvider } from "~/contexts/ThemeContext";
import { queryClient } from "~/lib/query-client";
import { router } from "~/router";

import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("missing #root element");

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HotkeysProvider defaultOptions={{ hotkey: { preventDefault: true } }}>
        <ThemeProvider>
          <ScopeProvider>
            <RouterProvider router={router} />
          </ScopeProvider>
        </ThemeProvider>
      </HotkeysProvider>
    </QueryClientProvider>
  </StrictMode>,
);
