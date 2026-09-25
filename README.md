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
- `language`: `name` / `description` の言語 (下の「言語」を参照。既定: ブラウザの言語)
- `scale`: 表示の倍率 (既定: `1`)
- `autoPopupMenu`: 右クリックでメニューを出すか (既定: `true`)
- `balloon`: 吹き出しの見た目 (下の「見た目」を参照。キャラクターファイルの設定の上に重ねる)

### Agent

`show` / `hide` / `play` / `speak` / `think` / `moveTo` / `gestureAt` / `delay` は順番待ちに入り、前のものが終わってから 1 つずつ実行されます (Microsoft Agent と同じ)。

| メソッド | 動き |
| --- | --- |
| `show(fast?)` | 登場する (Showing の状態のアニメーション。多くは `Show`)。`fast` なら、すぐ出す |
| `hide(fast?, callback?, { immediate? })` | 退場する (Hiding の状態のアニメーション。多くは `Hide`)。前の命令が終わってから隠れる。`immediate: true` なら順番待ちを捨ててすぐ隠れる (clippy.js と同じ) |
| `play(name, timeout = 5000, callback?)` | 再生する。`timeout` を過ぎたら、終了分岐で自然に終わらせる。無いアニメーションなら `false` |
| `animate()` | 待機動作以外から、1 つ選んで再生する |
| `animations()` / `hasAnimation(name)` | アニメーションの一覧・あるかどうか |
| `speak(text, hold?)` / `speak(text, { hold, url })` | 吹き出しでしゃべる。`hold` なら、`closeBalloon()` まで吹き出しを閉じない。`"A\|B\|C"` のように `\|` で区切ると、毎回 1 つをランダムに選ぶ。`url` を渡すと、その音声ファイル (.wav / .mp3 など) でしゃべり、音の大きさに合わせて口を動かす (本家の Speak の Url と同じ) |
| `think(text)` | 考えごとの吹き出し (雲形) に出す。声は出さず、口も動かさない (本家の Think と同じ) |
| `closeBalloon()` | 吹き出しを閉じる |
| `moveTo(x, y, duration = 1000)` | 移動する (Moving〜 の状態のアニメーション → 最後のコマのまま移動 → 戻りの動き)。`duration` が 0 か、隠れている間は、すぐ移る |
| `gestureAt(x, y)` | その方向を指す (Gesturing〜 の状態のアニメーション。無ければ `Gesture〜`、`Look〜`)。指した姿勢は次の動きまで保つ |
| `delay(ms = 250)` | 次の命令まで待つ |
| `stopCurrent()` / `stop(request?)` | いまの動きを終わらせる / 順番待ちも全部捨てる (登場・退場の途中なら、それは最後まで)。`request` を渡すと、その命令だけ止める |
| `stopAll(types?)` | 種類ごとに止める (`"play"` / `"speak"` / `"move"`。省略すると登場・退場の途中も含めて全部) |
| `wait(request)` | 別のキャラクターの命令が終わるまで待つ (2 体の掛け合い) |
| `interrupt(request)` | 順番が来たら、別のキャラクターの命令を止める |
| `pause()` / `resume()` | 一時停止・再開 |
| `reposition()` | 画面の中に収める |

本家のプロパティ: `visible`、`left` / `top`、`idleOn`、`moveCause`、`visibilityCause`、`balloonVisible`、`extraData`、`version`、`guid`、`originalWidth` / `originalHeight`、`speed` / `pitch`、`soundEffectsOn`、`activate()` / `active` (いちばん手前に出す。表示・クリック・ドラッグでも手前に出る)

msagent.js で足したもの: `name`、`description`、`language`、`scale` / `width` / `height` (大きさ)、`balloonStyle` (吹き出しの見た目)、`speaking`、`sound`、`voice`、`on()` / `off()` (イベント)、`hitTest(clientX, clientY)`、`destroy()`、`element`、`canvas`、`character`、`player`

キャラクターはドラッグで動かせ、ダブルクリックで `animate()` します。透明な部分 (キャラクターの周り) は押せず、クリックは下のページにそのまま届きます。
### イベント

`agent.on(type, listener)` で受け取れます (`agent` は `EventTarget` なので、`addEventListener` でも同じです)。中身は `event.detail` に入ります。

```js
agent.on("click", (e) => agent.speak(`(${e.detail.x}, ${e.detail.y}) を押されました`));
agent.on("dblclick", (e) => e.preventDefault()); // ダブルクリックで animate() しない
agent.on("animationend", (e) => console.log(e.detail.name));
```

| イベント | いつ | `detail` |
| --- | --- | --- |
| `click` / `dblclick` | 絵の部分をクリック (左・中・右ボタン。ドラッグの後は来ない)。`dblclick` を `preventDefault()` すると `animate()` しない | `x`, `y`, `button` (`"left"` / `"middle"` / `"right"`), `shift`, `ctrl`, `alt`, `originalEvent` |
| `dragstart` / `dragend` | ドラッグで動かし始めた / 終えた | `x`, `y` (キャラクターの左上) |
| `move` | 移った | `x`, `y`, `by` (`"drag"` / `"moveTo"` / `"reposition"` = ブラウザの窓が小さくなり、画面の中に戻した) |
| `show` / `hide` | 出た / 消えた | `cause` (`"program"` / `"user"`) |
| `requeststart` / `requestcomplete` | 命令を始めた / 終えた | `request` |
| `balloonshow` / `balloonhide` | 吹き出しが出た / 閉じた | なし |
| `idlestart` / `idlecomplete` | 待機状態に入った / 抜けた (次の命令が始まった) | なし |
| `command` | 右クリックのメニューで、`commands` に足した項目が選ばれた | `name` |
| `animationstart` / `animationend` | アニメーションが始まった / 終わった | `name`, `idle` (待機動作か) |
| `speakstart` / `speakend` | しゃべり始めた / 終えた (途中でやめたときも。`think()` でも来る) | `text`, `thought` (`think()` か) |
| `resize` | 大きさが変わった | `width`, `height`, `scale` |
| `bookmark` | 読み上げの目印 (`\Mrk=番号\`) まで来た (`think()` でも来る) | `id` |

### 右クリックのメニュー

キャラクターを右クリックすると、本家と同じくメニューが出ます。`agent.commands` に足した項目と、「隠す」が並びます。

```js
agent.commands.add("search", "検索(&S)");                    // & の次の文字がアクセスキー
agent.commands.add("help", "ヘルプ(&H)", { enabled: false }); // 灰色で選べない
agent.commands.defaultCommand = "search";                   // 太字にする
agent.on("command", (e) => {
  if (e.detail.name === "search") agent.speak("何を探しますか？");
});

agent.autoPopupMenu = false;   // 右クリックでは出さない
agent.showPopupMenu(x, y);     // 自分で出す
```

メニューは矢印キー・Enter・アクセスキー・Esc でも操作できます。「隠す」で隠れたときは、`hide` イベントの `cause` が `"user"` になります。見た目はクラス `.msagent-menu` / `.msagent-menu-item` / `.msagent-menu-separator` で変えられます。

### 命令 (Request)

`show` / `hide` / `play` / `speak` / `think` / `moveTo` / `gestureAt` / `delay` / `wait` / `interrupt` は、命令 (`AgentRequest`) を返します (本家の Request オブジェクトと同じ)。`await` すると、終わったときの状態が返ります。

```js
const request = agent.play("Wave");
request.status;             // "pending" (順番待ち) / "inProgress" (実行中)
await request;              // "complete" / "failed" / "interrupted"
agent.stop(request);        // この命令だけ止める

// 2 体の掛け合い
const q = genie.speak("なぜニワトリは道を渡ったの？");
robby.wait(q);              // genie がしゃべり終えるまで待つ
robby.speak("わからないなあ");
```

キャラクターに無いアニメーションを `play()` したときは、clippy.js と同じく `false` を返します。隠れている間の `speak` / `think` は、`failed` になります (本家と同じ)。

### 読み上げの制御タグ

`speak()` の文には、本家と同じ制御タグを書けます。タグは `\` で始まり `\` で終わり、大文字小文字は問いません。`\` という文字そのものは `\\` と書きます。

```js
agent.speak(String.raw`こんにちは。\Pau=500\\Spd=120\ゆっくり話します。\Rst\\Mrk=1\元に戻りました。`);
agent.on("bookmark", (e) => console.log("目印", e.detail.id)); // → 目印 1
```

| タグ | 意味 |
| --- | --- |
| `\Pau=ミリ秒\` | 間を空ける |
| `\Spd=語/分\` | 速さを変える |
| `\Pit=Hz\` | 高さを変える |
| `\Vol=0〜65535\` | 音量を変える |
| `\Rst\` | 速さ・高さ・音量を元に戻す |
| `\Map="読み"="表示"\` | 読み上げる文と、吹き出しに出す文を変える |
| `\Mrk=番号\` | 目印。ここまで読むと `bookmark` イベントが来る |
| `\Lst\` | 直前の発言を繰り返す (これだけを書く。目印は繰り返さない) |
| `\Emp\` `\Chr=…\` `\Ctx=…\` | 強調・声色・文脈。ブラウザの読み上げではできないので、取り除くだけ |

`think()` では、本家と同じく `\Mrk\` だけを使い、ほかのタグは取り除きます。吹き出しには、タグを除いた文が出ます。

### 言語

`.acs` には、名前と紹介文が言語ごとに入っています (Office のキャラクターは 30 言語ほど)。

```js
agent.name;                              // ブラウザの言語に一番合うもの
agent.language = "zh-TW";                // 以後 agent.name / agent.description は繁体字中国語
agent.character.getName("de");           // 言語を指定して取る (BCP 47)
agent.character.getDescription(0x0411);  // Windows の言語 ID でもよい
agent.character.languages;               // 入っている言語 (例: ["en", "ja-JP", "zh-TW", …])
```

指定した言語が無ければ、同じ言語の別の地域 → 英語 → 最初に入っているもの、の順に選びます。

`agent.language` を指定すると、読み上げと吹き出しの言語にもなります (本家の LanguageID と同じ)。指定しなければ、読み上げの言語は文から推測します (かな・漢字があれば日本語、無ければ英語)。
読み上げの声は、本家と同じく言語 → 性別の順に合うものを選びます。ブラウザの声には性別の情報が無いので、声の名前 (Haruka、Ichiro、David など) から推測します。年齢は、ブラウザからは分からないので使いません。`.act` には言語ごとの名前が無いので、いつも同じ名前です。

### 大きさ

```js
agent.scale = 2;     // 2 倍 (拡大はドット絵のまま)
agent.width = 64;    // 幅を 64px に (縦横の比は保つ。本家の Width と同じ)
agent.height;        // いまの表示の高さ (px)
```

大きさを変えても、足もと (下端の真ん中) の位置は変わりません。

### キャラクターの設定

`agent.character` から、キャラクターファイルに入っている設定を読めます。

```js
agent.character.width, agent.character.height; // 元の大きさ (px)
agent.character.guid;     // "{4E574F44-B521-11D0-9E9A-00C04FD7081F}"
agent.character.voice;    // { speed: 156, pitch: 50, language: "en-US", gender: "male", age: 30, style: "Business", engine: "{…}", mode: "{…}" }
agent.character.balloon;  // { background: "#ffffe1", foreground: "#000000", border: "#000000", fontFamily: "MS Sans Serif", fontSize: 13, lines: 2, charsPerLine: 32, … }
```

声の `speed` (1 分あたりの単語数) と `pitch` (Hz) は、`speak()` の読み上げの速さ・高さにも使います。入っていない項目は `undefined` です (Office のアシスタントには声の設定が無いものが多い)。

### 見た目

吹き出しの色・文字・幅は、キャラクターファイルの設定 (Character Editor で決めたもの) から付きます。
`agent.balloonStyle` で、その上に好きな項目だけを重ねられます。

```js
agent.balloonStyle = { background: "#222222", foreground: "#ffffff", fontSize: 16 };
agent.balloonStyle = { ...agent.balloonStyle, border: "#1e5aa8" }; // 今の見た目に足す
agent.balloonStyle = undefined;                                  // キャラクターファイルの設定に戻す
msagent.load({ name: "Merlin", balloon: { fontFamily: '"Yu Gothic UI", sans-serif' } }); // 読み込むときに指定
```

| 項目 | 内容 |
| --- | --- |
| `background` / `foreground` / `border` | 背景・文字・縁の色 (CSS の色) |
| `fontFamily` / `fontSize` / `fontWeight` / `italic` | 文字 (`fontSize` は px、`fontWeight` は 400 / 700 など) |
| `underline` / `strikethrough` | 下線・取り消し線 |
| `charsPerLine` | 1 行の文字数 (吹き出しの幅になる) |
| `lines` | 行数 (`sizeToText` が `false` のときの高さ) |
| `enabled` | 吹き出しを使うか。`false` なら `speak` は声だけ、`think` は何も出さない |
| `sizeToText` | 高さを文の量に合わせるか。`false` なら `lines` 行の高さに固定し、はみ出した分は上へ流す |
| `autoHide` | しゃべり終えたら自動で閉じるか。`false` なら次の `speak` / `think`、`hide`、キャラクターのクリック・ドラッグまで出したまま |
| `autoPace` | 読み上げに合わせて言葉を少しずつ出すか (声を出さないときも、口の動きに合わせて出す)。`false` なら最初から全文 |

`enabled` / `sizeToText` / `autoHide` / `autoPace` の既定値も、キャラクターファイルの設定 (Character Editor の Word Balloon のページ) から付きます。

読み出すと、いま使われている見た目 (ファイルの設定 + 重ねた項目) が返ります。設定の無いキャラクター (.act など) は `DEFAULT_BALLOON_STYLE` (薄い黄色に黒い縁) が元になります。

角の丸みや影など、ここに無いものは CSS で指定します (`.msagent-balloon { border-radius: 12px; }` など)。ページの CSS で `background` などを直接指定すると、`balloonStyle` より優先されます。

見た目は CSS で変えられます。クラス名は `.msagent` (キャラクター)、`.msagent-balloon` (吹き出し)、`.msagent-tip` (しっぽ)、`.msagent-content` (文) と、吹き出しの向きの `.msagent-top-left` / `.msagent-top-right` / `.msagent-bottom-left` / `.msagent-bottom-right` です。

### 状態 (States)

登場・退場・移動・指す・しゃべる・待機動作では、キャラクターの作者が「状態」(Showing、Hiding、MovingLeft、GesturingLeft、Speaking、IdlingLevel1〜3 など) に割り当てたアニメーションを使います。1 つの状態に複数あれば、毎回ランダムに選びます。割り当てが無ければ、`Show` / `Hide` / `Move〜` / `Gesture〜` などの名前で探します。
向き (Left / Right) はキャラクターから見た向きなので、画面の左へ動くときは MovingRight になります。

隠れている間も順番待ちは進みます。`play` は描かずにすぐ終わり、`moveTo` はすぐ移り、`speak` / `think` は何も出しません (本家も、隠れたキャラクターは音を出せません)。

### clippy.js との違い

- 読み込むのは clippy.js 用に変換したファイル (`agent.js` と画像) ではなく、`.acs` / `.act` そのものです。
- `speak()` は声に出して読み、口も動かします (`voice: false` で声なし)。
- CSS のクラス名は `.clippy-*` ではなく `.msagent-*` です。
- `show` / `hide` も順番待ちに入ります (本家と同じ)。clippy.js のように、すぐ隠れたいときは `hide(false, callback, { immediate: true })`。
- 吹き出しの色や文字は、キャラクターごとの設定になります。
- イベント (`agent.on()`)、言語ごとの名前・紹介文 (`agent.language`)、考えごとの吹き出し (`think()`) を足しています。
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
