import { defineConfig } from "@playwright/test";

/**
 * テスト:
 * - unit: ブラウザを使わない (タグの解析・言語・声・口の形・順番待ち・キャラクターファイルの読み込み)
 * - browser: テスト用のページ (tests/harness) でキャラクターを動かす
 * - demo: example のデモのページを操作する
 *
 * キャラクターファイルは同梱していないので、置き場所を MSAGENT_CHARACTERS に書く (複数なら ; で区切る。Mac / Linux は :)。
 * 無いファイルを使うテストは飛ばす。ブラウザは、インストール済みの Chrome を使う (PW_CHANNEL で変えられる)
 */
const PORT = 5199;

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.PW_CHANNEL ?? "chrome",
    // 効果音・音声ファイルを、クリックせずに鳴らせるようにする
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
    viewport: { width: 1200, height: 900 },
    locale: "ja-JP",
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/tests/harness/index.html`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "unit", testMatch: /unit[\\/].*\.spec\.ts$/ },
    { name: "browser", testMatch: /browser[\\/].*\.spec\.ts$/ },
    { name: "demo", testMatch: /demo[\\/].*\.spec\.ts$/ },
  ],
});
