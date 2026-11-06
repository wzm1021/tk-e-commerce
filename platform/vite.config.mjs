import { defineConfig } from "vite";
import path from "node:path";
const apiTarget = process.env.TIDELAB_API_TARGET ?? "http://127.0.0.1:9080";
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 4310,
    strictPort: true,
    proxy: {
      "/api": apiTarget,
      "/healthz": apiTarget,
    },
  },
  build: {
    rollupOptions: {
      input: {
        app: path.resolve("index.html"),
        admin: path.resolve("admin.html"),
      },
    },
  },
  esbuild: { jsx: "automatic" },
});
