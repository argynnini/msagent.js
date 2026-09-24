import { resolve } from "node:path";
import { defineConfig } from "vite";

// 既定: ESM (dist/msagent.js)。--mode global: <script> 用 (dist/msagent.iife.js、window.msagent)
export default defineConfig(({ mode }) => {
  const global = mode === "global";
  return {
    build: {
      outDir: resolve(__dirname, "dist"),
      emptyOutDir: !global,
      sourcemap: true,
      lib: global
        ? { entry: resolve(__dirname, "src/global.ts"), name: "msagent", formats: ["iife"], fileName: () => "msagent.iife.js" }
        : { entry: resolve(__dirname, "src/index.ts"), formats: ["es"], fileName: () => "msagent.js" },
    },
  };
});
