import { defineConfig } from "vitest/config";
import path from "node:path";

const dirname = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
      "server-only": path.resolve(dirname, "./src/test/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
  },
});
