# msagent.js

Microsoft Agent のキャラクター (`.acs`) と、Office 97 のアシスタント (`.act`) を、ブラウザだけで動かすライブラリです。
変換済みのスプライトは要りません。キャラクターファイルをそのまま読み込み、canvas に描きます。

- 🎞️ **本家どおりのアニメーション** — 分岐・終了分岐・戻りアニメ・効果音、移動や指さしの動きまで、Microsoft Agent と同じ順番で再生
- 🗣️ **しゃべって、口を動かす** — Web Speech API の読み上げや音声ファイル (.lwv も) に合わせて口を動かす
- 🎙️ **声で呼びかける** — 右クリックのメニューと同じコマンドを、声でも選べる
- 🖱️ **触って遊べる** — ドラッグで動かし、ダブルクリックでアニメーション。透明な部分のクリックは下のページに届く
- ⏱️ **命令は順番に** — 命令は順番待ちで 1 つずつ実行し、`await` で終わりを待てる
- 📦 **依存なし・変換なし** — ESM と `<script>` の両方、型定義付き

[OfficeAgent-Web](https://github.com/argynnini/OfficeAgent-Web) から、キャラクターの再生部分を切り出したものです。

**目次**
[はじめる](#はじめる) ·
[動かす](#動かす) ·
[しゃべる](#しゃべる) ·
[反応する](#反応する) ·
[見た目](#見た目) ·
[プロパティ一覧](#プロパティ一覧) ·
[注意](#注意) ·
[開発](#開発) ·
[ライセンス](#ライセンス)

## はじめる

### インストール

```sh
npm install msagent.js
```

### 最初の例

```js
import msagent from "msagent.js";

const agent = await msagent.load("/agents/Merlin.acs");
agent.show();
await agent.speak("こんにちは！"); // 読み終わるまで待つ
agent.play("Congratulate");
agent.moveTo(100, 100);

agent.on("click", () => agent.animate()); // 押されたら、何か 1 つ再生する
```

`<script>` で読み込むときは、`window.msagent` から使えます。

```html
<script src="https://cdn.jsdelivr.net/npm/msagent.js"></script>
<script>
  msagent.load("Merlin.acs").then((agent) => agent.show());
</script>
```

### msagent.load

```js
const agent = await msagent.load(name);
const agent = await msagent.load({ name, scale: 2, voice: false }); // 設定を付ける
msagent.load(name, successCb, failCb, path);                        // コールバックでも受け取れる
msagent.load({ name, scale: 2 }, successCb, failCb);
```

`name` には、URL、名前 (`"Merlin"` → `path + "Merlin.acs"`)、`File` / `Blob`、`ArrayBuffer` を渡せます。

| 設定 | 中身 | 既定 |
| --- | --- | --- |
| `path` | 名前の前に付ける場所 | `msagent.BASE_PATH` |
| `selector` | キャラクターを置く要素 | `body` |
| `sound` | 効果音を鳴らすか | `true` |
| `voice` | `speak()` で声に出して読むか (`false` なら吹き出しと口の動きだけ) | `true` |
| `tags` | 読み上げの制御タグを使うか (`false` なら、タグも文字としてそのまま。[制御タグ](#読み上げの制御タグ)) | `true` |
| `idle` | 待機動作を再生するか | `true` |
| `language` | 名前・紹介文・読み上げの言語 ([言語](#言語)) | ブラウザの言語 |
| `scale` | 表示の倍率 | `1` |
| `balloon` | 吹き出しの見た目 ([吹き出し](#吹き出し)。ファイルの設定の上に重ねる) | なし |
| `autoPopupMenu` | 右クリックでメニューを出すか | `true` |
| `listeningKey` | 押している間、声のコマンドを聞くキー ([音声認識](#音声認識)) | なし |
| `listeningTip` | 聞いている間、聞き取りのヒントを出すか | `true` |
| `raiseRequestErrors` | 命令の失敗を例外にするか ([命令を待つ](#命令を待つ-request)) | `false` |
| `successCb` / `failCb` | 読み込めた / 読み込めなかったときに呼ぶ | なし |

## 動かす

### 命令

次の命令は順番待ちに入り、前のものが終わってから 1 つずつ実行されます (Microsoft Agent と同じ)。

| 命令 | 動き |
| --- | --- |
| `show(fast?)` | 登場する。`fast` なら、アニメーションなしですぐ出す |
| `hide(fast?, callback?, { immediate? })` | 退場する。`immediate: true` なら、順番待ちを捨ててすぐ隠れる |
| `play(name, timeout = 5000, callback?)` | アニメーションを再生する。`timeout` を過ぎたら、自然に終わらせる |
| `speak(text, options?)` | 吹き出しでしゃべる ([しゃべる](#しゃべる)) |
| `think(text, options?)` | 考えごとの吹き出しに出す ([しゃべる](#しゃべる)) |
| `moveTo(x, y, duration = 1000)` | 移動する。`duration` が 0 か、隠れている間は、すぐ移る |
| `gestureAt(x, y)` | その方向を指す。指した姿勢は次の動きまで保つ |
| `delay(ms = 250)` | 次の命令まで待つ |
| `wait(request)` / `interrupt(request)` | 別のキャラクターの命令を待つ / 止める ([2 体の掛け合い](#命令を待つ-request)) |
| `get(type, name, queue = true)` | 先に取り寄せる (下を参照) |

次のものは、順番待ちに入らず、すぐ効きます。

| メソッド | 動き |
| --- | --- |
| `animate()` | 待機動作以外から、1 つ選んで再生する |
| `animations()` / `hasAnimation(name)` | アニメーションの一覧 / あるかどうか |
| `stop(request?, options?)` | 順番待ちを全部捨て、いまの動きを終わらせる。`request` を渡すと、その命令だけ止める |
| `stopCurrent(options?)` | いまの動きだけを終わらせる |
| `stopAll(types?, options?)` | 種類ごとに止める (`"play"` / `"speak"` / `"move"`)。省略すると、登場・退場の途中も含めて全部 |
| `closeBalloon()` | 吹き出しを閉じる |
| `pause()` / `resume()` | 一時停止・再開 |
| `reposition()` | 画面の中に収める |
| `listen(on)` | 声のコマンドを聞く ([音声認識](#音声認識)) |
| `activate()` | いちばん手前に出す (表示・クリック・ドラッグでも手前に出る) |
| `destroy()` | 片付ける (要素を消し、それ以降の命令は `failed`) |

- キャラクターに無いアニメーションを `play()` したときは、`false` を返します。
- `stop()` は、登場・退場のアニメーションの途中なら、それは最後まで再生します (本家と同じ)。
- 止めたアニメーションは、終わりの動き (終了分岐) をたどって自然に終わります。`{ immediate: true }` を渡すと、その場で切って、止まっているときの絵に戻します (例: `agent.stop(request, { immediate: true })`)。
- アニメーションを止めると、そのアニメーションの効果音も止まります (退場のアニメーションの音は、隠れた後も最後まで鳴らします)。
- 移動の途中で `stop()` すると、その場で止まります。

`get(type, name)` は本家の Get と同じです。`type` は `"animation"` / `"state"` / `"wavefile"`、`name` はカンマ区切りで複数書けます。
ファイルは丸ごと読み込み済みなので、アニメーション・状態は、あるかを確かめるだけです (無ければ `failed`)。`"wavefile"` は URL を読み込んでおき、`speak(text, { url })` を速くします。`queue` が `false` なら順番待ちに入りません。

### 命令を待つ (Request)

命令は、命令のオブジェクト (`AgentRequest`。本家の Request と同じ) を返します。`await` すると、終わったときの状態が返ります。

```js
const request = agent.play("Wave");
request.status;             // "pending" (順番待ち) / "inProgress" (実行中)
await request;              // "complete" / "failed" / "interrupted"
agent.stop(request);        // この命令だけ止める
request.number;             // failed / interrupted のときの理由の番号 (それ以外は 0)
request.description;        // failed のときの理由 (文)

// 2 体の掛け合い
const q = genie.speak("なぜニワトリは道を渡ったの？");
robby.wait(q);              // genie がしゃべり終えるまで待つ
robby.speak("わからないなあ");
```

`request.number` は、`import { RequestError } from "msagent.js"` の `RequestError.hidden` (隠れている)・`animationNotFound`・`stateNotFound`・`interrupted` (止められた)・`invalidSound` などと比べられます。
隠れている間の `speak` / `think` は `failed` になります (本家と同じ)。

`raiseRequestErrors: true` にすると、失敗した命令を `await` したときに `AgentRequestError` (`number`・`message`・`request`) の例外になり、無いアニメーションの `play()` などは、その場で例外を投げます。止められた (`interrupted`) ときは例外にしません。
本家の RaiseRequestErrors の既定は `true` ですが、msagent.js の既定は `false` です。

```js
const agent = await msagent.load({ name: "Merlin", raiseRequestErrors: true });
try {
  await agent.speak("こんにちは"); // 隠れていれば AgentRequestError
} catch (e) {
  console.log(e.number === RequestError.hidden);
}
```

### 状態 (States)

登場・退場・移動・指す・しゃべる・待機動作では、キャラクターの作者が「状態」に割り当てたアニメーションを使います。

| 命令 | 状態 | 割り当てが無いときに探す名前 |
| --- | --- | --- |
| `show()` / `hide()` | Showing / Hiding | `Show` / `Hide` |
| `moveTo()` | MovingLeft など 4 方向 | `Move〜` |
| `gestureAt()` | GesturingLeft など 4 方向 | `Gesture〜`、`Look〜` |
| `speak()` | Speaking | |
| 待機動作 | IdlingLevel1〜3 | `Idle〜`、`DeepIdle〜` |

- 1 つの状態に複数あれば、毎回ランダムに選びます。
- 向き (Left / Right) はキャラクターから見た向きです。画面の左へ動くときは MovingRight になります。
- `moveTo()` は、移動前の動き → 最後のコマのまま移動 → 戻りの動き、の順です。
- 待機動作は、何もしない時間が少し続いてから始まり、放置が長いほど深い動き (居眠りなど) になります。
- 隠れている間も順番待ちは進みます。`play` は描かずにすぐ終わり、`moveTo` はすぐ移り、`speak` / `think` は何も出しません (本家も、隠れたキャラクターは音を出せません)。

## しゃべる

### speak と think

```js
agent.speak("こんにちは！");
agent.speak("おはよう|こんにちは|こんばんは");  // | で区切ると、毎回 1 つをランダムに選ぶ
agent.speak("待ってね", { hold: true });        // closeBalloon() まで吹き出しを閉じない (speak(text, true) でも同じ)
agent.speak("しーっ", { voice: false });        // この 1 回だけ声を出さない (吹き出しと口の動きだけ)
agent.speak("", { url: "hello.wav" });          // 音声ファイルでしゃべる
agent.speak("C:\\temp", { tags: false });    // この 1 回だけ、タグを使わない (\ や <…> もそのまま読んで出す)
agent.think("どうしようかな");                   // 考えごとの吹き出し
```

- `speak(text, { url })` は、音声ファイル (.wav / .mp3 など) でしゃべり、音の大きさに合わせて口を動かします (本家の Speak の Url と同じ)。.lwv なら音素で口を動かします ([下を参照](#言語情報つきの音声ファイル-lwv))。
- `think()` は、考えごとの吹き出し (雲形) に出します。声は出さず、口も動かしません (本家と同じ)。
- `think()` の間は考える動き (`Thinking`、無ければ `Think`) を再生し、終わったら元の姿勢に戻します (msagent.js で足したもの)。
- `think(text, { voice: true })` なら、考えごとの吹き出しのまま声に出して読みます (msagent.js で足したもの)。

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
| `\Emp\` | 次の言葉を強調する (ブラウザでは本物の強調ができないので、少しゆっくり・少し高く読む) |
| `\Chr=Whisper\` | ささやき声 (ブラウザではできないので、小さい声で読む)。`\Chr=Normal\` か `\Rst\` で戻す。`Monotone` は何もしない |
| `\Ctx=…\` | 文脈 (記号や略語の読み方)。ブラウザ任せなので、取り除くだけ |

- `think()` では、本家と同じく `\Mrk\` だけを使い、ほかのタグは取り除きます (`think(text, { voice: true })` では、すべてのタグを使います)。
- 吹き出しには、タグを除いた文が出ます。

### SAPI 5 の XML のタグ

SAPI 5 の XML のタグも書けます (msagent.js で足したもの)。`\Spd\` などのタグと混ぜてもかまいません。

```js
agent.speak('<rate absspeed="-5">ゆっくり</rate>話します。<silence msec="500"/><emph>ここが大事</emph>です。');
agent.speak('Call <spell>ABC</spell>. <lang langid="411">こんにちは</lang> <bookmark mark="done"/>');
agent.on("bookmark", (e) => console.log(e.detail.mark)); // → "done" (e.detail.id は NaN)
```

| タグ | 意味 |
| --- | --- |
| `<rate absspeed="-10〜10">` / `<rate speed="…">` | 速さ (元の速さから / いまの速さから。10 で 3 倍、-10 で 1/3) |
| `<pitch absmiddle="-10〜10">` / `<pitch middle="…">` | 高さ (10 で 2 倍、-10 で 1/2) |
| `<volume level="0〜100">` | 音量 |
| `<emph>` | 強調する (`\Emp\` と同じく、少しゆっくり・少し高く読む) |
| `<spell>` | 1 文字ずつ区切って読む (吹き出しには、そのまま出す) |
| `<silence msec="ミリ秒"/>` | 間を空ける |
| `<bookmark mark="名前"/>` | 目印。ここまで読むと `bookmark` イベントが来る (名前は数字でなくてもよい) |
| `<sub alias="読み">表示</sub>` / `<map alias="読み">表示</map>` | 読み上げる文と、吹き出しに出す文を変える (`\Map\` と同じ。`<sub>` は SSML のタグ) |
| `<lang langid="411">` | 言語 (Windows の言語 ID。16 進) |
| `<voice required="Gender=Female;Language=411">` | 声の性別と言語 (`required` になければ `optional` も見る。`Name`・`Age` などは使わない) |
| `<pron>` / `<context>` / `<partofsp>` / `<sapi>` / `<p>` / `<s>` | ブラウザ任せなので、タグだけ取り除く (中の文は読む) |
| `<!-- コメント -->` | 取り除く (読まず、吹き出しにも出さない。閉じていなければ文字のまま) |

- `<rate>` `<pitch>` `<volume>` `<emph>` `<spell>` `<lang>` `<voice>` は、中身だけに効き、閉じたら元に戻ります (入れ子にもできます)。`<rate speed="5"/>` のように閉じた形で書くと、囲んでいるタグが閉じるか、文の終わりまで効きます。
- 知らないタグ (`<b>` など) は、文字のまま残します。
- SAPI 5 のタグがある文だけ、`&lt;` `&amp;` などの文字参照を文字に戻します。
- `think()` では、`<bookmark>` だけを使い、ほかのタグは取り除きます。

タグを使わず、文をそのまま読んで出したいときは、`agent.tags = false` (読み込むときは `msagent.load({ name, tags: false })`) にします。1 回だけなら `speak(text, { tags: false })` / `think(text, { tags: false })` です。`\Lst\` もただの文字になります。`"A|B|C"` から 1 つを選ぶ動きは、タグではないので、そのままです。

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

- 指定した言語が無ければ、同じ言語の別の地域 → 英語 → 最初に入っているもの、の順に選びます。`.act` には言語ごとの名前が無いので、いつも同じ名前です。
- `agent.language` を指定すると、読み上げと吹き出しの言語にもなります (本家の LanguageID と同じ)。指定しなければ、読み上げの言語は文から推測します (かな・漢字があれば日本語、無ければ英語)。
- 読み上げの声は、本家と同じく言語 → 性別の順に合うものを選びます。ブラウザの声には性別の情報が無いので、声の名前 (Haruka、Ichiro、David など) から推測します。年齢は、ブラウザからは分からないので使いません。
- 声の速さ・高さは、キャラクターファイルの設定を使います ([キャラクターの設定](#キャラクターの設定))。

### 音をまとめて切る

`msagent.audioOutput` で、全キャラクターの音をまとめて切れます (本家の AudioOutput。本家はユーザーの設定なので読むだけですが、ここでは変えられます)。ESM では `import { audioOutput } from "msagent.js"` でも使えます。

```js
msagent.audioOutput.enabled = false;      // 全キャラクターの声を出さない (吹き出しと口の動きだけ)
msagent.audioOutput.soundEffects = false; // 全キャラクターの効果音を鳴らさない
msagent.audioOutput.status;               // 0: 空いている / 1: 音を出せない / 3: 聞き取り中で声が聞こえている / 4: 声に出してしゃべっている / 5: 聞き取り中で声を待っている
```

## 反応する

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
| `click` / `dblclick` | 絵の部分を押した (ドラッグの後は来ない) | `x`, `y`, `button` (`"left"` / `"middle"` / `"right"`), `shift`, `ctrl`, `alt`, `originalEvent` |
| `dragstart` / `dragend` | ドラッグで動かし始めた / 終えた | `x`, `y` (キャラクターの左上) |
| `move` | 移った | `x`, `y`, `by` (`"drag"` / `"moveTo"` / `"reposition"`) |
| `show` / `hide` | 出た / 消えた | `cause` (`"program"` / `"user"`) |
| `requeststart` / `requestcomplete` | 命令を始めた / 終えた | `request` |
| `animationstart` / `animationend` | アニメーションが始まった / 終わった | `name`, `idle` (待機動作か) |
| `speakstart` / `speakend` | しゃべり始めた / 終えた (途中でやめたときも。`think()` でも来る) | `text`, `thought` (`think()` か) |
| `bookmark` | 読み上げの目印 (`\Mrk=番号\` か `<bookmark/>`) まで来た (`think()` でも来る) | `id` (番号。数字でない `<bookmark>` の名前なら `NaN`), `mark` (書いたとおりの文字) |
| `balloonshow` / `balloonhide` | 吹き出しが出た / 閉じた | なし |
| `idlestart` / `idlecomplete` | 待機状態に入った / 抜けた (次の命令が始まった) | なし |
| `command` | 右クリックのメニューか声で、コマンドが選ばれた | `name`, `source` (`"menu"` / `"voice"`), `confidence` (0〜100), `voice` (聞き取った文), `count` (合ったコマンドの数), `alternatives` (2 番目・3 番目) |
| `listenstart` / `listencomplete` | 聞き取りを始めた / 終えた | `mode` (`"program"` / `"key"`) / `cause` (`"program"` / `"timeout"` / `"key"` / `"finished"` / `"error"`) |
| `helpcomplete` | ヘルプモードで、何かが選ばれた ([ヘルプモード](#ヘルプモード)) | `name`, `cause`, `helpContextId` |
| `resize` | 大きさが変わった | `width`, `height`, `scale` |

- `dblclick` を `preventDefault()` すると、`animate()` しません。
- `move` の `by` が `"reposition"` のときは、ブラウザの窓が小さくなり、画面の中に戻したときです。
- 別の戻りアニメ (`MoveRightReturn` など) も、その名前で 1 つのアニメーションとして `animationstart` / `animationend` が来ます。

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

- メニューは矢印キー・Enter・アクセスキー・Esc でも操作できます。
- 「隠す」で隠れたときは、`hide` イベントの `cause` が `"user"` になります。
- 文字は `agent.commands.fontName` / `fontSize` (ポイント) で変えられます (本家の Commands.FontName / FontSize と同じ)。
- 見た目はクラス `.msagent-menu` / `.msagent-menu-item` / `.msagent-menu-separator` で変えられます。

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

`listen(true)` は 10 秒聞き、1 つ言い終えたらやめます。`listen(false)` でやめます。音声認識が使えなければ `false` を返します。

`voice` の書き方は本家と同じです。ブラウザの音声認識は自由な文を返すので、msagent.js が聞き取った文と照らし合わせます。
大文字小文字・全角半角・カタカナとひらがな・句読点・空白の違いは気にしません。

| 書き方 | 意味 | 例 |
| --- | --- | --- |
| `[ ]` | 省いてよい言葉 | `hello [there]` |
| `( \| )` | どれか 1 つ | `(hello \| hi)` |
| `*` / `+` | 直前の言葉・まとまりの 0 回以上 / 1 回以上の繰り返し | `please* try this`、`(New York)+` |
| `...` | 何を言ってもよいところ | `[...] check mail [...]` |
| `表示\読み` | 表示と読み。どちらで聞き取っても合う (日本語は `かな\漢字`) | `1st\first`、`けんさく\検索` |

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

### ヘルプモード

`agent.helpModeOn = true` の間は、キャラクターをクリック・ドラッグしたり、右クリックのメニューの項目や声のコマンドを選んだりすると、`click` / `dragstart` / `command` の代わりに `helpcomplete` イベントが来て、ヘルプモードが終わります (本家の HelpModeOn と同じ)。ポインターはヘルプの形になります。

```js
agent.helpContextId = 1;                                            // キャラクター自体のヘルプ
agent.commands.add("search", "検索(&S)", { helpContextId: 2 });
agent.on("helpcomplete", (e) => showHelp(e.detail.helpContextId));
helpButton.onclick = () => (agent.helpModeOn = true);
```

- 本家は Windows のヘルプファイル (HelpFile) を開きますが、ブラウザでは開けないので、`helpContextId` をイベントで渡します。これを使って、アプリ側でヘルプを出してください。
- `helpcomplete` の `cause` は、`"character"` / `"command"` / `"hide"` / `"openCommandsWindow"` / `"closeCommandsWindow"` のどれかです。
- 右クリックのメニューは、ヘルプモードの間も出せます (`autoPopupMenu` が `false` なら、右クリックもヘルプ)。
- `helpModeOn = false` でやめたときは、`helpcomplete` は来ません。

## 見た目

### 大きさ

```js
agent.scale = 2;     // 2 倍 (拡大はドット絵のまま)
agent.width = 64;    // 幅を 64px に (縦横の比は保つ。本家の Width と同じ)
agent.height;        // いまの表示の高さ (px)
```

大きさを変えても、足もと (下端の真ん中) の位置は変わりません。

### 吹き出し

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
| `width` / `height` | 吹き出しの幅・高さ (px。縁と余白を含む)。`charsPerLine` / `lines` より優先 (msagent.js で足したもの) |
| `enabled` | 吹き出しを使うか。`false` なら `speak` は声だけ、`think` は何も出さない |
| `sizeToText` | 高さを文の量に合わせるか。`false` なら `lines` 行の高さに固定し、はみ出した分は上へ流す |
| `autoHide` | しゃべり終えたら自動で閉じるか。`false` なら次の `speak` / `think`、`hide`、キャラクターのクリック・ドラッグまで出したまま |
| `autoPace` | 読み上げに合わせて言葉を少しずつ出すか (声を出さないときも、口の動きに合わせて出す)。`false` なら最初から全文 |

- `enabled` / `sizeToText` / `autoHide` / `autoPace` の既定値も、キャラクターファイルの設定 (Character Editor の Word Balloon のページ) から付きます。
- `balloonStyle` を読み出すと、いま使われている見た目 (ファイルの設定 + 重ねた項目) が返ります。設定の無いキャラクター (.act など) は `DEFAULT_BALLOON_STYLE` (薄い黄色に黒い縁) が元になります。
- `height` を決めたときも、はみ出した分は上へ流します。

### CSS

角の丸みや影など、`balloonStyle` に無いものは CSS で指定します (`.msagent-balloon { border-radius: 12px; }` など)。ページの CSS で `background` などを直接指定すると、`balloonStyle` より優先されます。

| クラス | もの |
| --- | --- |
| `.msagent` | キャラクター |
| `.msagent-balloon` / `.msagent-tip` / `.msagent-content` | 吹き出し / しっぽ / 文 |
| `.msagent-top-left` / `.msagent-top-right` / `.msagent-bottom-left` / `.msagent-bottom-right` | 吹き出しの向き |
| `.msagent-menu` / `.msagent-menu-item` / `.msagent-menu-separator` | 右クリックのメニュー |
| `.msagent-listening-tip` | 聞き取りのヒント |
| `.msagent-commands-window` | 音声コマンドの窓 |

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

## プロパティ一覧

**本家と同じもの**

| プロパティ | 中身 |
| --- | --- |
| `visible` | 出ているか (読むだけ) |
| `left` / `top` | 画面上の位置 (px)。代入すると、すぐそこへ移る |
| `idleOn` | 待機動作を自動で再生するか |
| `moveCause` / `visibilityCause` | 最後に動いた / 出た・消えた原因 |
| `balloonVisible` | 吹き出しが出ているか。`false` を代入すると閉じる (しゃべっている途中なら読み終えてから)。`true` なら最後の文をもう一度出す |
| `extraData` / `version` / `guid` | 作者が入れたおまけの文字 / ファイルの版 / GUID |
| `originalWidth` / `originalHeight` | 元の大きさ (px) |
| `speed` / `pitch` | 読み上げの速さ (語/分) / 高さ (Hz)。キャラクターファイルの設定 (読むだけ) |
| `soundEffectsOn` | 効果音を鳴らすか (`sound` と同じ) |
| `active` | いちばん手前にいるか |
| `commands` | 右クリックのメニューと声のコマンド ([右クリックのメニュー](#右クリックのメニュー)) |
| `commandsWindow` | 音声コマンドの窓 ([音声コマンドの窓](#音声コマンドの窓)) |
| `autoPopupMenu` | 右クリックでメニューを出すか |
| `listening` / `srStatus` | 聞いているか / 音声入力が使えるか ([音声認識](#音声認識)) |
| `listeningKey` / `listeningTip` | 聞き取りキー / 聞き取りのヒントを出すか |
| `helpModeOn` / `helpContextId` | [ヘルプモード](#ヘルプモード) |
| `raiseRequestErrors` | 命令の失敗を例外にするか |

**msagent.js で足したもの**

| プロパティ | 中身 |
| --- | --- |
| `name` / `description` / `language` | 名前 / 紹介文 / その言語 ([言語](#言語)) |
| `scale` / `width` / `height` | 大きさ ([大きさ](#大きさ)) |
| `balloonStyle` | 吹き出しの見た目 ([吹き出し](#吹き出し)) |
| `speaking` | しゃべっている途中か |
| `sound` / `voice` | 効果音を鳴らすか / `speak()` で声に出すか |
| `tags` | 読み上げの制御タグを使うか ([制御タグ](#読み上げの制御タグ)) |
| `on()` / `off()` | イベントを受け取る / やめる |
| `hitTest(clientX, clientY)` | その点がキャラクターの絵の上か |
| `element` / `canvas` | キャラクターの要素 (`div.msagent`) / 描いている canvas |
| `character` / `player` | キャラクターファイルの中身 / アニメーションの再生係 |

## 注意

- キャラクターファイルは同梱していません。Office 2000 / XP / 2003 に付属していたものや、[Agentpedia](https://agentpedia.tmafe.com/) などから入手してください。キャラクターの著作権は、それぞれの権利者にあります。
- ブラウザの制限で、効果音はページが一度クリックされるまで鳴りません。
- 読み上げの声は、ブラウザと OS に入っている声を使います。
- 音声認識は、Chrome・Edge では声をサーバーに送ります ([音声認識](#音声認識))。

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

## ライセンス

[MIT](LICENSE)。キャラクターファイル (.acs / .act) は含まれず、このライセンスの対象ではありません (著作権は、それぞれの権利者にあります)。
