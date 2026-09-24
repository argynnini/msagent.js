# msagent.js

Microsoft Agent のキャラクター (`.acs`) と、Office 97 のアシスタント (`.act`) を、ブラウザだけで再生するライブラリです。
変換済みのスプライトは要りません。キャラクターファイルをそのまま読み込み、canvas に描きます。

- 🎞️ アニメーションの分岐・終了分岐・戻りアニメ・効果音に対応
- 🗣️ Web Speech API で読み上げ、口の画像を切り替えて口パク
- 💤 放置すると待機動作 (Idle 系) をときどき再生
- 📦 依存パッケージなし、ESM と `<script>` 用 (IIFE) の両方

[OfficeAgent-Web](https://github.com/argynnini/OfficeAgent-Web) から、キャラクターの再生部分を切り出したものです。

## インストール

```sh
npm install msagent.js
```

## 使い方

```ts
import { Agent } from "msagent.js";

const agent = await Agent.load("/agents/Merlin.acs"); // URL・File・Blob・ArrayBuffer が使える
document.body.append(agent.canvas);

await agent.show();                 // Greeting (無ければ Show) で登場
await agent.play("Congratulate");   // アニメーションを再生 (大文字小文字は問わない)
await agent.speak("こんにちは！", { onProgress: (text) => (balloon.textContent = text) });
await agent.hide();
```

`<script>` で読み込むときは、`window.MSAgent` から使えます。

```html
<script src="https://cdn.jsdelivr.net/npm/msagent.js"></script>
<script>
  MSAgent.Agent.load("Merlin.acs").then((agent) => document.body.append(agent.canvas));
</script>
```

### Agent

| | |
| --- | --- |
| `Agent.load(source, options?)` | 読み込む。`options`: `canvas` (描く先)、`sound` (効果音、既定 true)、`idle` (待機動作、既定 true) |
| `animations` | アニメーション名の一覧 |
| `play(name)` | 再生する。終わると resolve (無い名前なら `false`) |
| `release()` | 終了分岐をたどって自然に終わらせる |
| `stop()` | すぐ止める |
| `show()` / `hide()` | 登場・退場 |
| `speak(text, { onProgress })` | 読み上げて口を動かす |
| `cancelSpeech()` | 読み上げをやめる |
| `sound` | 効果音の オン / オフ |
| `hitTest(clientX, clientY)` | その位置にキャラクターの絵があるか (透明部分のクリックを無視するのに) |
| `destroy()` | 後片付け |

もっと細かく扱いたいときは、`AcsCharacter` / `ActCharacter` (解析)、`AcsPlayer` (再生)、`Speaker` (読み上げ)、`IdleController` (待機動作) を直接使えます。

## 注意

- キャラクターファイルは同梱していません。Office 2000 / XP / 2003 に付属していたものや、[Agentpedia](https://agentpedia.tmafe.com/) などから入手してください。キャラクターの著作権は、それぞれの権利者にあります。
- ブラウザの制限で、効果音はページが一度クリックされるまで鳴りません。
- 読み上げの声は、ブラウザと OS に入っている声を使います。

## 開発

```sh
npm install
npm run dev     # example/ のデモ (キャラクターファイルを選んで試す)
npm run build   # dist/ に ESM・IIFE・型定義を出力
```
