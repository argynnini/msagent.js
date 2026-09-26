import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = import.meta.dirname;

// 既定: ESM (dist/msagent.js)。--mode global: <script> 用 (dist/msagent.iife.js、window.msagent)
export default defineConfig(({ mode }) => {
  const global = mode === "global";
  return {
    build: {
      outDir: resolve(root, "dist"),
      emptyOutDir: !global,
      sourcemap: true,
      lib: global
        ? {
            entry: resolve(root, "src/global.ts"),
            name: "msagent",
            formats: ["iife"],
            fileName: () => "msagent.iife.js",
          }
        : { entry: resolve(root, "src/index.ts"), formats: ["es"], fileName: () => "msagent.js" },
      rolldownOptions: {
        output: {
          // 出力を ASCII だけにする (日本語は \uXXXX)。ページが Shift_JIS などでも、<script> で読み込める。
          // ESM は Vite の既定と同じく空白を残し、<script> 用は空白も詰める
          minify: {
            compress: true,
            mangle: true,
            codegen: { removeWhitespace: global, asciiOnly: true },
          },
        },
      },
    },
  };
});
