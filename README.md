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
- `listeningKey`: 聞き取りキー。押している間、声のコマンドを聞く (下の「音声認識」を参照。既定: なし)
- `listeningTip`: 聞いている間、聞き取りのヒントを出すか (既定: `true`)
- `raiseRequestErrors`: 命令の失敗を例外にするか (下の「命令」を参照。既定: `false`)
- `balloon`: 吹き出しの見た目 (下の「見た目」を参照。キャラクターファイルの設定の上に重ねる)

### Agent

`show` / `hide` / `play` / `speak` / `think` / `moveTo` / `gestureAt` / `delay` / `get` は順番待ちに入り、前のものが終わってから 1 つずつ実行されます (Microsoft Agent と同じ)。

| メソッド | 動き |
| --- | --- |
| `show(fast?)` | 登場する (Showing の状態のアニメーション。多くは `Show`)。`fast` なら、すぐ出す |
| `hide(fast?, callback?, { immediate? })` | 退場する (Hiding の状態のアニメーション。多くは `Hide`)。前の命令が終わってから隠れる。`immediate: true` なら順番待ちを捨ててすぐ隠れる (clippy.js と同じ) |
| `play(name, timeout = 5000, callback?)` | 再生する。`timeout` を過ぎたら、終了分岐で自然に終わらせる。無いアニメーションなら `false` |
| `animate()` | 待機動作以外から、1 つ選んで再生する |
| `animations()` / `hasAnimation(name)` | アニメーションの一覧・あるかどうか |
| `speak(text, hold?)` / `speak(text, { hold, url, voice })` | 吹き出しでしゃべる。`hold` なら、`closeBalloon()` まで吹き出しを閉じない。`voice: false` なら、この 1 回だけ声を出さない (吹き出しと口の動きだけ)。`"A\|B\|C"` のように `\|` で区切ると、毎回 1 つをランダムに選ぶ。`url` を渡すと、その音声ファイル (.wav / .mp3 など) でしゃべり、音の大きさに合わせて口を動かす (本家の Speak の Url と同じ)。.lwv なら音素で口を動かす (下の「言語情報つきの音声ファイル」) |
| `think(text, { voice }?)` | 考えごとの吹き出し (雲形) に出す。声は出さず、口も動かさない (本家の Think と同じ)。その間は考える動き (`Thinking`、無ければ `Think`) を再生し、終わったら元の姿勢に戻す (msagent.js で足したもの)。`voice: true` なら、考えごとの吹き出しのまま声に出して読む (msagent.js で足したもの) |
| `closeBalloon()` | 吹き出しを閉じる |
| `moveTo(x, y, duration = 1000)` | 移動する (Moving〜 の状態のアニメーション → 最後のコマのまま移動 → 戻りの動き)。`duration` が 0 か、隠れている間は、すぐ移る |
| `gestureAt(x, y)` | その方向を指す (Gesturing〜 の状態のアニメーション。無ければ `Gesture〜`、`Look〜`)。指した姿勢は次の動きまで保つ |
| `delay(ms = 250)` | 次の命令まで待つ |
| `get(type, name, queue = true)` | 先に取り寄せる (本家の Get と同じ)。`type` は `"animation"` / `"state"` / `"wavefile"`、`name` はカンマ区切りで複数。ファイルは丸ごと読み込み済みなので、アニメーション・状態はあるかを確かめるだけ (無ければ `failed`)。`"wavefile"` は URL を読み込んでおく (`speak(text, { url })` が速くなる)。`queue` が `false` なら順番待ちに入らない |
| `stopCurrent()` / `stop(request?)` | いまの動きを終わらせる / 順番待ちも全部捨てる (登場・退場の途中なら、それは最後まで)。`request` を渡すと、その命令だけ止める |
| `stopAll(types?)` | 種類ごとに止める (`"play"` / `"speak"` / `"move"`。省略すると登場・退場の途中も含めて全部) |
| `wait(request)` | 別のキャラクターの命令が終わるまで待つ (2 体の掛け合い) |
| `interrupt(request)` | 順番が来たら、別のキャラクターの命令を止める |
| `pause()` / `resume()` | 一時停止・再開 |
| `reposition()` | 画面の中に収める |
| `listen(on)` | 声のコマンドを聞く (下の「音声認識」を参照)。`true` なら 10 秒聞き、1 つ言い終えたらやめる。`false` ならやめる。音声認識が使えなければ `false` |

本家のプロパティ: `visible`、`left` / `top`、`idleOn`、`moveCause`、`visibilityCause`、`balloonVisible` (`false` を代入すると閉じる。しゃべっている途中なら読み終えてから。`true` なら最後の文をもう一度出す)、`extraData`、`version`、`guid`、`originalWidth` / `originalHeight`、`speed` / `pitch`、`soundEffectsOn`、`listening`、`srStatus` (音声入力が使えるか)、`listeningKey`、`listeningTip`、`helpModeOn` / `helpContextId` (下の「ヘルプモード」)、`commandsWindow` (音声コマンドの窓)、`raiseRequestErrors`、`activate()` / `active` (いちばん手前に出す。表示・クリック・ドラッグでも手前に出る)

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
| `command` | 右クリックのメニューか声で、`commands` の項目が選ばれた (本家の Command と同じ) | `name`, `source` (`"menu"` / `"voice"`), `confidence` (0〜100), `voice` (聞き取った文), `count` (合ったコマンドの数), `alternatives` (2 番目・3 番目) |
| `helpcomplete` | ヘルプモードで、キャラクター・メニューの項目・声のコマンドが選ばれた (本家の HelpComplete と同じ) | `name`, `cause` (`"command"` / `"hide"` / `"character"` / `"openCommandsWindow"` / `"closeCommandsWindow"`), `helpContextId` |
| `listenstart` / `listencomplete` | 聞き取りを始めた / 終えた | `mode` (`"program"` / `"key"`) / `cause` (`"program"` / `"timeout"` / `"key"` / `"finished"` / `"error"`) |
| `animationstart` / `animationend` | アニメーションが始まった / 終わった。別の戻りアニメ (`MoveRightReturn` など) も、その名前で 1 つのアニメーションとして来る | `name`, `idle` (待機動作か) |
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

`agent.commands.fontName` / `fontSize` (ポイント) で、メニューの文字を変えられます (本家の Commands.FontName / FontSize と同じ)。
メニューは矢印キー・Enter・アクセスキー・Esc でも操作できます。「隠す」で隠れたときは、`hide` イベントの `cause` が `"user"` になります。見た目はクラス `.msagent-menu` / `.msagent-menu-item` / `.msagent-menu-separator` で変えられます。

### 命令 (Request)

`show` / `hide` / `play` / `speak` / `think` / `moveTo` / `gestureAt` / `delay` / `wait` / `interrupt` / `get` は、命令 (`AgentRequest`) を返します (本家の Request オブジェクトと同じ)。`await` すると、終わったときの状態が返ります。

```js
const request = agent.play("Wave");
request.status;             // "pending" (順番待ち) / "inProgress" (実行中)
await request;              // "complete" / "failed" / "interrupted"
agent.stop(request);        // この命令だけ止める
request.number;             // failed / interrupted のときの理由の番号 (本家の Request.Number と同じ。それ以外は 0)
request.description;        // failed のときの理由 (文)

// 2 体の掛け合い
const q = genie.speak("なぜニワトリは道を渡ったの？");
robby.wait(q);              // genie がしゃべり終えるまで待つ
robby.speak("わからないなあ");
```

`raiseRequestErrors: true` にすると (本家の RaiseRequestErrors。本家の既定は `true` ですが、clippy.js に合わせて既定は `false`)、失敗した命令を `await` すると `AgentRequestError` (`number`・`message`・`request`) の例外になり、無いアニメーションの `play()` などは、その場で例外を投げます。止められた (`interrupted`) ときは例外にしません。

```js
const agent = await msagent.load({ name: "Merlin", raiseRequestErrors: true });
try {
  await agent.speak("こんにちは"); // 隠れていれば AgentRequestError
} catch (e) {
  console.log(e.number === RequestError.hidden);
}
```

`request.number` の値は、`import { RequestError } from "msagent.js"` の `RequestError.hidden` (隠れている)・`animationNotFound`・`stateNotFound`・`interrupted` (止められた)・`invalidSound` などと比べられます。

キャラクターに無いアニメーションを `play()` したときは、clippy.js と同じく `false` を返します。隠れている間の `speak` / `think` は、`failed` になります (本家と同じ)。

### 音声出力の全体の設定

`msagent.audioOutput` で、全キャラクターの音をまとめて切れます (本家の AudioOutput と同じ。本家はユーザーの設定なので読むだけですが、ここでは変えられます)。

```js
msagent.audioOutput.enabled = false;      // 全キャラクターの声を出さない (吹き出しと口の動きだけ)
msagent.audioOutput.soundEffects = false; // 全キャラクターの効果音を鳴らさない
msagent.audioOutput.status;               // 0: 空いている / 1: 音を出せない / 3: 聞き取り中で声が聞こえている / 4: 声に出してしゃべっている / 5: 聞き取り中で声を待っている
```

ESM では `import { audioOutput } from "msagent.js"` でも使えます。

### ヘルプモード

`agent.helpModeOn = true` の間は、キャラクターをクリック・ドラッグしたり、右クリックのメニューの項目や声のコマンドを選んだりすると、`click` / `dragstart` / `command` の代わりに `helpcomplete` イベントが来て、ヘルプモードが終わります (本家の HelpModeOn と同じ)。ポインターはヘルプの形になります。
本家は Windows のヘルプファイル (HelpFile) を開きますが、ブラウザでは開けないので、`helpContextId` をイベントで渡します。これを使って、アプリ側でヘルプを出してください。

```js
agent.helpContextId = 1;                                            // キャラクター自体のヘルプ
agent.commands.add("search", "検索(&S)", { helpContextId: 2 });
agent.on("helpcomplete", (e) => showHelp(e.detail.helpContextId)); // cause: "character" / "command" / "hide" など
helpButton.onclick = () => (agent.helpModeOn = true);
```

右クリックのメニューは、ヘルプモードの間も出せます (`autoPopupMenu` が `false` なら、右クリックもヘルプ)。`helpModeOn = false` でやめたときは、`helpcomplete` は来ません。

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
| `\Emp\` | 次の言葉を強調する。ブラウザの読み上げでは本物の強調ができないので、少しゆっくり・少し高く読む |
| `\Chr=Whisper\` | ささやき声。ブラウザではできないので、小さい声で読む。`\Chr=Normal\` か `\Rst\` で戻す (`Monotone` はブラウザではできないので、何もしない) |
| `\Ctx=…\` | 文脈 (記号や略語の読み方)。ブラウザ任せなので、取り除くだけ |

`think()` では、本家と同じく `\Mrk\` だけを使い、ほかのタグは取り除きます (`think(text, { voice: true })` では、すべてのタグを使います)。吹き出しには、タグを除いた文が出ます。

### 言語情報つきの音声ファイル (.lwv)

本家の Linguistic Information Sound Editing Tool で作った `.lwv` (WAV に、単語と音素の時刻を足したもの) も、`speak(text, { url })` でしゃべれます。

```js
agent.speak("", { url: "hello.lwv" });        // 文が空なら、ファイルに入っている単語を吹き出しに出す
agent.speak("Hello!", { url: "hello.lwv" });  // 吹き出しには text を出す
```

- 口は、音の大きさではなく音素から決めます (1 秒に 30 回。音素から口の形への対応は、本家の Microsoft Agent 2.0 と同じ表)。
- 吹き出しの文は、単語の時刻に合わせて出します (`text` の単語の数がファイルと違うときは、音の長さに合わせて少しずつ)。
- 単語の文字は、ファイルの言語 ID の文字コード (日本語なら Shift_JIS) で読みます。
- 中身だけを読むときは `readLwv(arrayBuffer)` (単語・音素・言語 ID) を使えます。

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
agent.character.trayIcon; // タスクトレイ用の小さなアイコン (.acs のみ)。imageToDataUrl(icon) で <img> や favicon に使える
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
| `width` / `height` | 吹き出しの幅・高さ (px。縁と余白を含む)。`charsPerLine` / `lines` より優先し、高さを決めたときは、はみ出した分を上へ流す (msagent.js で足したもの) |
| `enabled` | 吹き出しを使うか。`false` なら `speak` は声だけ、`think` は何も出さない |
| `sizeToText` | 高さを文の量に合わせるか。`false` なら `lines` 行の高さに固定し、はみ出した分は上へ流す |
| `autoHide` | しゃべり終えたら自動で閉じるか。`false` なら次の `speak` / `think`、`hide`、キャラクターのクリック・ドラッグまで出したまま |
| `autoPace` | 読み上げに合わせて言葉を少しずつ出すか (声を出さないときも、口の動きに合わせて出す)。`false` なら最初から全文 |

`enabled` / `sizeToText` / `autoHide` / `autoPace` の既定値も、キャラクターファイルの設定 (Character Editor の Word Balloon のページ) から付きます。

読み出すと、いま使われている見た目 (ファイルの設定 + 重ねた項目) が返ります。設定の無いキャラクター (.act など) は `DEFAULT_BALLOON_STYLE` (薄い黄色に黒い縁) が元になります。

角の丸みや影など、ここに無いものは CSS で指定します (`.msagent-balloon { border-radius: 12px; }` など)。ページの CSS で `background` などを直接指定すると、`balloonStyle` より優先されます。

見た目は CSS で変えられます。クラス名は `.msagent` (キャラクター)、`.msagent-balloon` (吹き出し)、`.msagent-tip` (しっぽ)、`.msagent-content` (文) と、吹き出しの向きの `.msagent-top-left` / `.msagent-top-right` / `.msagent-bottom-left` / `.msagent-bottom-right` です。

### 音声認識

本家と同じく、声でコマンドを選べます。ブラウザの音声認識 (Web Speech API) を使うので、**Chrome・Edge・Safari で動き、Firefox では使えません**。
**Chrome と Edge は、声をインターネット上のサーバー (Google・Microsoft) に送って認識します。** 初めて聞くときに、ブラウザがマイクの許可を求めます。

```js
agent.commands.voiceCaption = "メール";                                // 聞き取りのヒントに出す名前
agent.commands.add("check", "メールを見る(&C)", { voice: "[...] (メール | めーる) を (見る | みる | 見せて) [...]" });
agent.commands.add("send", "送る(&S)", { voice: "[please] send [the] mail", voiceCaption: "送る" });
agent.on("command", (e) => {
  if (e.detail.name === "check") agent.speak("メールを開きます");
  if (e.detail.source === "voice" && e.detail.count === 0) agent.speak("よく分かりませんでした");
});

button.onclick = () => agent.listen(true);                     // 10 秒聞く (1 つ言い終えたらやめる)
msagent.load({ name: "Merlin", listeningKey: "ScrollLock" });  // キーを押している間聞く (本家の Listening key)
```

`voice` の書き方は本家と同じです。ブラウザの音声認識は自由な文を返すので、msagent.js が聞き取った文と照らし合わせます。

| 書き方 | 意味 | 例 |
| --- | --- | --- |
| `[ ]` | 省いてよい言葉 | `hello [there]` |
| `( \| )` | どれか 1 つ | `(hello \| hi)` |
| `*` / `+` | 直前の言葉・まとまりの 0 回以上 / 1 回以上の繰り返し | `please* try this`、`(New York)+` |
| `...` | 何を言ってもよいところ | `[...] check mail [...]` |
| `表示\読み` | 表示と読み。どちらで聞き取っても合う (日本語は `かな\漢字`) | `1st\first`、`けんさく\検索` |

大文字小文字・全角半角・カタカナとひらがな・句読点・空白の違いは気にしません。

- **聞く言語**は `agent.language` (無ければブラウザの言語) です。
- **確かさ：** `command` の `confidence` は、ブラウザが返す確かさ (0〜1) を 0〜100 にしたものです。コマンドの `confidence` 以下なら、聞き取りのヒントに `confidenceText` を出します (本家と同じ)。
- **聞き取りキー：** いちばん手前のキャラクターだけが聞きます。キーを押すと Listening、声が聞こえ始めると Hearing の状態のアニメーションを再生します (命令やしゃべりの途中なら、邪魔しません)。
- **聞き取りのヒント：** 聞いている間、キャラクターの下に「-- マーリンが聞いています --」「「メールを見る」と聞こえました」などを出します。見た目はクラス `.msagent-listening-tip` で変えられます。
- **聞こえている間：** ユーザーの声が聞こえている間にしゃべらせると、声は出さず、吹き出しだけを出します (ユーザーの声とキャラクターの声が混ざらないように。本家と同じ)。
- **用意してあるコマンド：** 「hide Merlin」「隠れて」と言うと隠れます (`command` の `name` は `""`、`hide` の `cause` は `"user"`)。`agent.commands.globalVoiceCommandsEnabled = false` で使わなくできます。
- **使えないとき：** `agent.srStatus` で理由が分かります (本家の SRStatus と同じ値)。0: 使える、1: マイクが使えない、4: このブラウザには音声認識が無い・認識サービスにつながらない、5: マイク・音声認識を許可されていない、6: そのほか。許可されているかは、一度聞いてみるまで分かりません。
- 文法だけを試すときは、`compileVoiceGrammar(voice)` (照らし合わせる関数を返す) を使えます。

#### 音声コマンドの窓

いま声で言えるコマンドの一覧を出す窓です (本家の Voice Commands Window)。このキャラクターの声のコマンド (`voiceCaption`、無ければ `caption` と、言う言葉) と、用意してあるコマンドが並びます。

- **開き方：** 右クリックのメニューの「音声コマンドを開く」(音声認識が使えるブラウザだけに出る)、声で「what can I say」「show commands」「コマンドを見せて」「何て言えばいい」、または `agent.commandsWindow.visible = true`
- **閉じ方：** 右上の ×、声で「close commands window」「コマンドを閉じて」、または `agent.commandsWindow.visible = false`
- 画面の右下に出ます (本家はタスクバーのアイコンの隣)。位置や見た目は、クラス `.msagent-commands-window` で変えられます。
- 開いている間にコマンドを変えたときは、`agent.commandsWindow.refresh()` で出し直します (聞き始めたときは自動で出し直す)。
- `left` / `top` / `width` / `height` で、画面上の位置と大きさが分かります (本家の CommandsWindow と同じ。閉じていれば 0)。

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
- イベント (`agent.on()`)、言語ごとの名前・紹介文 (`agent.language`)、考えごとの吹き出し (`think()`)、音声認識 (`listen()`) を足しています。
- 待機動作は、何もしない時間が少し続いてから始まり、放置が長いほど深い動き (居眠りなど) になります。

## 注意

- キャラクターファイルは同梱していません。Office 2000 / XP / 2003 に付属していたものや、[Agentpedia](https://agentpedia.tmafe.com/) などから入手してください。キャラクターの著作権は、それぞれの権利者にあります。
- ブラウザの制限で、効果音はページが一度クリックされるまで鳴りません。
- 読み上げの声は、ブラウザと OS に入っている声を使います。
- 音声認識は、Chrome・Edge では声をサーバーに送ります (上の「音声認識」を参照)。

## 開発

```sh
npm install
npm run dev     # example/ のデモ (キャラクターファイルを選んで試す)
npm run build   # dist/ に ESM・<script> 用・型定義を出力
npm test        # テスト (下を参照)
```

### テスト

[Playwright](https://playwright.dev/) で、次の 3 つに分けて確かめます。

| 種類 | 中身 |
| --- | --- |
| `unit` | ブラウザを使わないもの (制御タグの解析・言語の選び方・声の選び方・口の形・命令の順番待ち・キャラクターファイルと .lwv の読み込み) |
| `browser` | テスト用のページ (`tests/harness`) でキャラクターを動かす (状態・命令・しゃべる・考える・吹き出し・マウス・メニュー・大きさ・待機動作など) |
| `demo` | `example` のデモのページを操作する |

キャラクターファイルは同梱していないので、置き場所を環境変数 `MSAGENT_CHARACTERS` に書きます (複数なら Windows は `;`、Mac / Linux は `:` で区切る)。使うのは `Merlin.acs`・`finfin.acs`・`CLIPPIT.ACS`・`ROCKY.act`・`dolphin.act` で、無いファイルを使うテストは飛ばします。

```sh
# Windows (PowerShell)
$env:MSAGENT_CHARACTERS = "C:\agents;C:\Users\me\Downloads"; npm test
# Mac / Linux
MSAGENT_CHARACTERS=~/agents npm test
npm run test:unit   # ブラウザを使わないものだけ (速い)
```

ブラウザは、インストール済みの Chrome を使います (`PW_CHANNEL=msedge` などで変えられる。Playwright のブラウザを使うときは `npx playwright install chromium` の後に `PW_CHANNEL=chromium`)。
