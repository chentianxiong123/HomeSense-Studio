"use client";

import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { useState } from "react";

import "@pico/i18n";
import { routeTree } from "@pico/routeTree.gen";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

let client: QueryClient | undefined;

export default function PicoAppInner() {
  const [queryClient] = useState(() => {
    if (client) return client;
    const module = require("@tanstack/react-query") as typeof import("@tanstack/react-query");
    client = new module.QueryClient({
      defaultOptions: { queries: { staleTime: 5000, retry: 1 } },
    });
    return client;
  });

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}