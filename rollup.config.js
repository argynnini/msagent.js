import { dts } from "rollup-plugin-dts";

// tsc が書き出した型定義 (dist/types/) を、1 つのファイル (dist/msagent.d.ts) にまとめる。
// パッケージには dist/msagent.* だけを入れる (package.json の files)
export default {
  input: "dist/types/index.d.ts",
  output: { file: "dist/msagent.d.ts", format: "es" },
  plugins: [dts()],
};
