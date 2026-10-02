import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    // OneDrive-synced folders drop native file-watch events, leaving Vite serving stale modules.
    watch: { usePolling: true, interval: 200 },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
