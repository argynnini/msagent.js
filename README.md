# msagent.js

Microsoft Agent のキャラクター (`.acs`) と、Office 97 のアシスタント (`.act`) を、ブラウザだけで動かすライブラリです。
変換済みのスプライトは要りません。キャラクターファイルをそのまま読み込み、canvas に描きます。
API は [clippy.js](https://github.com/smore-inc/clippy.js) と同じ形なので、clippy.js から `clippy` を `msagent` に書き換えるだけで移れます。

- 🎞️ アニメーションの分岐・終了分岐・戻りアニメ・効果音に対応
- 🗣️ Web Speech API で読み上げ、口の画像を切り替えて口パク
- 💤 何もしていない間は、待機動作 (Idle 系) をときどき再生
- 📦 依存パッケージなし (jQuery も不要)、ESM と `<script>` 用の両方

[OfficeAgent-Web](https://github.com/argynnini/OfficeAgent-Web) から、キャラクターの再生部分を切り出したものです。

## インストール

```sh
npm install msagent.js
```

## 使い方

```js
import msagent from "msagent.js";

msagent.BASE_PATH = "/agents/"; // 名前だけで読み込むときの置き場所

msagent.load("Merlin", (agent) => { // → /agents/Merlin.acs
  agent.show();
  agent.speak("こんにちは！");
  agent.play("Congratulate");
  agent.moveTo(100, 100);
  agent.gestureAt(0, 0);
});
```

`<script>` で読み込むときは、`window.msagent` から使えます。

```html
<script src="https://cdn.jsdelivr.net/npm/msagent.js"></script>
<script>
  msagent.load("Merlin.acs", (agent) => agent.show());
</script>
```

### msagent.load

```js
msagent.load(name, successCb, failCb, path);
msagent.load({ name, successCb, failCb, path, selector, sound, voice, idle });
const agent = await msagent.load(name); // Promise でも受け取れる
```

- `name`: 名前 (`"Merlin"` → `path + "Merlin.acs"`)、URL、`File` / `Blob`、`ArrayBuffer`
- `path`: 名前の前に付ける場所 (既定: `msagent.BASE_PATH`)
- `selector`: キャラクターを置く要素 (既定: `body`)
- `sound`: 効果音 (既定: `true`)
- `voice`: `speak()` で声に出して読むか (既定: `true`。`false` なら吹き出しと口の動きだけ)
- `idle`: 待機動作 (既定: `true`)

### Agent

clippy.js と同じく、`play` / `speak` / `moveTo` / `gestureAt` / `delay` は順番待ちに入り、前のものが終わってから 1 つずつ実行されます。

| メソッド | 動き |
| --- | --- |
| `show(fast?)` | 登場する (`Show` を再生)。`fast` なら、すぐ出す |
| `hide(fast?, callback?)` | 退場する (`Hide` を再生してから消す) |
| `play(name, timeout = 5000, callback?)` | 再生する。`timeout` を過ぎたら、終了分岐で自然に終わらせる。無いアニメーションなら `false` |
| `animate()` | 待機動作以外から、1 つ選んで再生する |
| `animations()` / `hasAnimation(name)` | アニメーションの一覧・あるかどうか |
| `speak(text, hold?)` | 吹き出しでしゃべる。`hold` なら、`closeBalloon()` まで吹き出しを閉じない |
| `closeBalloon()` | 吹き出しを閉じる |
| `moveTo(x, y, duration = 1000)` | 移動する (`Move〜` のアニメーションがあれば再生しながら) |
| `gestureAt(x, y)` | その方向を指す (`Gesture〜`、無ければ `Look〜`) |
| `delay(ms = 250)` | 次の命令まで待つ |
| `stopCurrent()` / `stop()` | いまの動きを終わらせる / 順番待ちも全部捨てる |
| `pause()` / `resume()` | 一時停止・再開 |
| `reposition()` | 画面の中に収める |

msagent.js で足したもの: `name`、`sound`、`voice`、`hitTest(clientX, clientY)`、`destroy()`、`element`、`canvas`、`character`、`player`

キャラクターはドラッグで動かせ、ダブルクリックで `animate()` します。透明な部分 (キャラクターの周り) は押せず、クリックは下のページにそのまま届きます。
見た目は CSS で変えられます。クラス名は `.msagent` (キャラクター)、`.msagent-balloon` (吹き出し)、`.msagent-tip` (しっぽ)、`.msagent-content` (文) と、吹き出しの向きの `.msagent-top-left` / `.msagent-top-right` / `.msagent-bottom-left` / `.msagent-bottom-right` です。

### clippy.js との違い

- 読み込むのは clippy.js 用に変換したファイル (`agent.js` と画像) ではなく、`.acs` / `.act` そのものです。
- `speak()` は声に出して読み、口も動かします (`voice: false` で声なし)。
- CSS のクラス名は `.clippy-*` ではなく `.msagent-*` です。
- 待機動作は、何もしない時間が少し続いてから始まり、放置が長いほど深い動き (居眠りなど) になります。

## 注意

- キャラクターファイルは同梱していません。Office 2000 / XP / 2003 に付属していたものや、[Agentpedia](https://agentpedia.tmafe.com/) などから入手してください。キャラクターの著作権は、それぞれの権利者にあります。
- ブラウザの制限で、効果音はページが一度クリックされるまで鳴りません。
- 読み上げの声は、ブラウザと OS に入っている声を使います。

## 開発

```sh
npm install
npm run dev     # example/ のデモ (キャラクターファイルを選んで試す)
npm run build   # dist/ に ESM・<script> 用・型定義を出力
```
