import { defineConfig } from "vitest/config";

// Own config so vitest does not climb to the dashboard app's vite.config.ts.
export default defineConfig({ test: { root: ".", include: ["test/**/*.test.ts"] } });
