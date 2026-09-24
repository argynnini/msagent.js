import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: resolve(__dirname, "dist"),
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      // <script> で読み込むときは window.MSAgent
      name: "MSAgent",
      formats: ["es", "iife"],
      fileName: (format) => (format === "es" ? "msagent.js" : `msagent.${format}.js`),
    },
    sourcemap: true,
  },
});
