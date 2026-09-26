# msagent.js

English | [日本語](README.ja.md)

A library that brings Microsoft Agent characters (`.acs`, and the web-delivered `.acf` + `.aca`) and Office 97 Assistants (`.act`) to life, right in the browser.
No pre-converted sprite sheets needed — it reads the original character files directly and draws them on a canvas.

- 🎞️ **Faithful animation** — branching, exit branches, return animations, sound effects, and the motions for moving and gesturing all play in the same order as in Microsoft Agent
- 🗣️ **Talks and lip-syncs** — moves the mouth in time with Web Speech API text-to-speech or audio files (including .lwv)
- 🎙️ **Voice commands** — users can pick the same commands as in the right-click menu by speaking them
- 🖱️ **Interactive** — drag to move, double-click to animate. Clicks on transparent areas pass through to the page underneath
- ⏱️ **Queued requests** — requests run one at a time, in order, and you can `await` each one
- 📦 **No dependencies, no conversion** — ships as ESM and as a `<script>` build, with TypeScript types

Extracted from the character playback engine of [OfficeAgent-Web](https://github.com/argynnini/OfficeAgent-Web).

**Contents**
[Getting started](#getting-started) ·
[Actions](#actions) ·
[Speaking](#speaking) ·
[Interaction](#interaction) ·
[Appearance](#appearance) ·
[Properties](#properties) ·
[Notes](#notes) ·
[Development](#development) ·
[License](#license)

## Getting started

### Install

```sh
npm install @argynnini/msagent.js
```

### First example

```js
import msagent from "@argynnini/msagent.js";

const agent = await msagent.load("/agents/Merlin.acs");
agent.show();
await agent.speak("Hello!"); // waits until it finishes speaking
agent.play("Congratulate");
agent.moveTo(100, 100);

agent.on("click", () => agent.animate()); // play something when clicked
```

When loaded with a `<script>` tag, it is available as `window.msagent`.

```html
<script src="https://cdn.jsdelivr.net/npm/@argynnini/msagent.js"></script>
<script>
  msagent.load("Merlin.acs").then((agent) => agent.show());
</script>
```

### msagent.load

```js
const agent = await msagent.load(name);
const agent = await msagent.load({ name, scale: 2, voice: false }); // with options
msagent.load(name, successCb, failCb, path); // callbacks work too
msagent.load({ name, scale: 2 }, successCb, failCb);
```

`name` can be a URL, a character name (`"Merlin"` → `path + "Merlin.acs"`), a `File` / `Blob`, or an `ArrayBuffer`.

An `.acf` (web-delivered character) contains only the character data and the list of animations; each animation lives in its own `.aca` file.
`.aca` files are fetched relative to the `.acf` URL (or relative to `baseUrl` when you pass a `File` or raw bytes).
Only the `preload` animations are fetched at load time; the rest are fetched when they are first played (which delays the start of that animation slightly). You can also fetch them ahead of time with `get()`.

| Option                 | Description                                                                                                             | Default                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `path`                 | Prefix prepended to a character name                                                                                    | `msagent.BASE_PATH`                                                  |
| `selector`             | Element to place the character in                                                                                       | `body`                                                               |
| `preload`              | For `.acf`: animations to fetch at load time (an array of state or animation names, or `"all"`)                         | `["Showing", "Hiding", "Speaking", "RestPose"]`                      |
| `baseUrl`              | For `.acf`: base URL for locating `.aca` files                                                                          | The `.acf` URL (or the page URL)                                     |
| `sound`                | Whether to play sound effects                                                                                           | `true`                                                               |
| `voice`                | Whether `speak()` reads text aloud (`false` shows the balloon and moves the mouth only)                                 | `true`                                                               |
| `tags`                 | Whether to process speech output tags (`false` shows tags as plain text; see [Speech output tags](#speech-output-tags)) | `true`                                                               |
| `idle`                 | Whether to play idle animations                                                                                         | `true`                                                               |
| `language`             | Language for the name, description, and speech ([Language](#language))                                                  | Browser language                                                     |
| `scale`                | Display scale                                                                                                           | `1`                                                                  |
| `balloon`              | Word balloon style ([Word balloon](#word-balloon); layered on top of the file's settings)                               | None                                                                 |
| `autoPopupMenu`        | Whether right-clicking shows the popup menu                                                                             | `true`                                                               |
| `listeningKey`         | Key to hold down to listen for voice commands ([Speech recognition](#speech-recognition))                               | None                                                                 |
| `listeningKeyTimeout`  | Seconds to keep listening after the listening key is released (if the user is mid-utterance, waits until they finish)   | `0` (stop immediately)                                               |
| `listeningTip`         | Whether to show the listening tip while listening                                                                       | `true`                                                               |
| `raiseRequestErrors`   | Whether failed requests throw ([Requests](#requests-agentrequest))                                                      | `false`                                                              |
| `taskbarIcon`          | Whether to show a taskbar icon (bottom right of the screen; click it to bring back a hidden character)                  | `false`                                                              |
| `ttsModeId`            | Voice used for speech (a browser voice's `voiceURI` or name)                                                            | Chosen by language and the character's voice gender                  |
| `srModeId`             | Speech recognition language (a BCP 47 tag such as `"en-US"`)                                                            | The speech language (`language`, or the browser language if not set) |
| `successCb` / `failCb` | Called when loading succeeds / fails                                                                                    | None                                                                 |

## Actions

### Queued methods

The following methods are queued and run one at a time, each starting after the previous one finishes (just like Microsoft Agent).

| Method                                   | What it does                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `show(fast?)`                            | Appears. With `fast`, appears immediately without animation                                      |
| `hide(fast?, callback?, { immediate? })` | Disappears. With `immediate: true`, discards the queue and hides right away                      |
| `play(name, timeout = 5000, callback?)`  | Plays an animation. After `timeout`, lets it finish naturally                                    |
| `speak(text, options?)`                  | Speaks in a word balloon ([Speaking](#speaking))                                                 |
| `think(text, options?)`                  | Shows text in a thought balloon ([Speaking](#speaking))                                          |
| `moveTo(x, y, duration = 1000)`          | Moves. Jumps immediately if `duration` is 0 or while hidden                                      |
| `gestureAt(x, y)`                        | Gestures toward a point. Holds the pose until the next action                                    |
| `delay(ms = 250)`                        | Waits before the next request                                                                    |
| `wait(request)` / `interrupt(request)`   | Waits for / stops another character's request ([Two characters talking](#requests-agentrequest)) |
| `get(type, name, queue = true)`          | Fetches ahead of time (see below)                                                                |

The following take effect immediately without being queued.

| Method                                | What it does                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `animate()`                           | Picks and plays one animation other than idle animations                                                    |
| `animations()` / `hasAnimation(name)` | Lists animations / checks whether one exists                                                                |
| `stop(request?, options?)`            | Discards the whole queue and ends the current action. Pass a `request` to stop only that one                |
| `stopCurrent(options?)`               | Ends only the current action                                                                                |
| `stopAll(types?, options?)`           | Stops by type (`"play"` / `"speak"` / `"move"`). If omitted, stops everything, including showing and hiding |
| `closeBalloon()`                      | Closes the word balloon                                                                                     |
| `pause()` / `resume()`                | Pauses / resumes                                                                                            |
| `reposition()`                        | Moves the character back inside the viewport                                                                |
| `listen(on)`                          | Listens for voice commands ([Speech recognition](#speech-recognition))                                      |
| `activate()`                          | Brings the character to the front (showing, clicking, and dragging do this too)                             |
| `destroy()`                           | Cleans up (removes the element; any later request ends as `failed`)                                         |

- `play()` returns `false` for an animation the character doesn't have.
- `stop()` lets a Showing or Hiding animation in progress play to the end (same as the original).
- A stopped animation follows its exit branches and ends naturally. Pass `{ immediate: true }` to cut it off on the spot and return to the rest pose (e.g. `agent.stop(request, { immediate: true })`).
- Stopping an animation also stops its sound effects (a Hiding animation's sound keeps playing to the end even after the character is hidden).
- Calling `stop()` during a move stops the character where it is.

`get(type, name)` works like the original Get. `type` is `"animation"` / `"state"` / `"wavefile"`, and `name` may list several names separated by commas.
For `.acf` characters, it fetches the animations' `.aca` files (if a file can't be fetched, is corrupt, or its checksum doesn't match the `.acf`, the request ends as `failed` with number `RequestError.invalidAnimation`). `.acs` / `.act` files are already fully loaded, so for animations and states it only checks that they exist (`failed` if not). `"wavefile"` preloads a URL so that `speak(text, { url })` starts faster. With `queue` set to `false`, the request isn't queued.

### Requests (AgentRequest)

Requests return a request object (`AgentRequest`, like the original Request object). Awaiting it resolves to its final status.

```js
const request = agent.play("Wave");
request.status; // "pending" (queued) / "inProgress" (running)
await request; // "complete" / "failed" / "interrupted"
agent.stop(request); // stop just this request
request.number; // reason code when failed / interrupted (0 otherwise)
request.description; // reason text when failed

// Two characters talking
const q = genie.speak("Why did the chicken cross the road?");
robby.wait(q); // wait until Genie finishes speaking
robby.speak("I don't know.");
```

`request.number` can be compared against `RequestError` from `import { RequestError } from "@argynnini/msagent.js"`: `RequestError.hidden` (the character is hidden), `animationNotFound`, `stateNotFound`, `interrupted` (stopped), `invalidSound`, and so on.
`speak` / `think` while hidden end as `failed` (same as the original).

With `raiseRequestErrors: true`, awaiting a failed request throws an `AgentRequestError` (`number`, `message`, `request`), and calls such as `play()` with a missing animation throw right away. Interrupted requests don't throw.
The original RaiseRequestErrors defaults to `true`, but msagent.js defaults to `false`.

```js
const agent = await msagent.load({ name: "Merlin", raiseRequestErrors: true });
try {
  await agent.speak("Hello"); // AgentRequestError if hidden
} catch (e) {
  console.log(e.number === RequestError.hidden);
}
```

### States

Showing, hiding, moving, gesturing, speaking, and idling use the animations the character's author assigned to each "state".

| Method              | State                             | Fallback names if unassigned |
| ------------------- | --------------------------------- | ---------------------------- |
| `show()` / `hide()` | Showing / Hiding                  | `Show` / `Hide`              |
| `moveTo()`          | MovingLeft etc. (4 directions)    | `Move…`                      |
| `gestureAt()`       | GesturingLeft etc. (4 directions) | `Gesture…`, `Look…`          |
| `speak()`           | Speaking                          |                              |
| Idle                | IdlingLevel1–3                    | `Idle…`, `DeepIdle…`         |

- When a state has several animations, one is picked at random each time.
- Directions (Left / Right) are from the character's point of view. Moving toward the left of the screen uses MovingRight.
- `moveTo()` plays the move-start animation → moves while holding the last frame → plays the return animation.
- Idle animations start after a short period of inactivity, and become deeper (such as dozing off) the longer the character is left alone.
- The queue keeps running while hidden: `play` finishes immediately without drawing, `moveTo` jumps immediately, and `speak` / `think` show nothing (in the original, too, hidden characters can't produce sound).

## Speaking

### speak and think

```js
agent.speak("Hello!");
agent.speak("Good morning|Hello|Good evening"); // separate with | to pick one at random each time
agent.speak("Hold on", { hold: true }); // keep the balloon open until closeBalloon() (same as speak(text, true))
agent.speak("Shh", { voice: false }); // no voice this time only (balloon and mouth movement only)
agent.speak("", { url: "hello.wav" }); // speak with an audio file
agent.speak("C:\\temp", { tags: false }); // no tags this time only (\ and <…> are read and shown as-is)
agent.think("Let me think…"); // thought balloon
```

- `speak(text, { url })` speaks using an audio file (.wav / .mp3, etc.) and moves the mouth according to the volume (like the original Speak's Url). For .lwv files, the mouth follows the phonemes ([see below](#linguistically-enhanced-sound-files-lwv)).
- `think()` shows the text in a thought (cloud) balloon. It doesn't speak aloud or move the mouth (same as the original).
- During `think()`, the thinking animation (`Thinking`, or `Think` if missing) plays, then the character returns to its previous pose (an msagent.js addition).
- `think(text, { voice: true })` reads the text aloud while keeping the thought balloon (an msagent.js addition).

### Speech output tags

Text passed to `speak()` may contain the same speech output tags as the original. Tags start and end with `\` and are case-insensitive. Write `\\` for a literal `\`.

```js
agent.speak(String.raw`Hello. \Pau=500\\Spd=120\I'll speak slowly. \Rst\\Mrk=1\Back to normal.`);
agent.on("bookmark", (e) => console.log("bookmark", e.detail.id)); // → bookmark 1
```

| Tag                          | Meaning                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `\Pau=ms\`                   | Pauses                                                                                                                      |
| `\Spd=words/min\`            | Changes the speed                                                                                                           |
| `\Pit=Hz\`                   | Changes the pitch                                                                                                           |
| `\Vol=0–65535\`              | Changes the volume                                                                                                          |
| `\Rst\`                      | Resets speed, pitch, and volume                                                                                             |
| `\Map="spoken"="displayed"\` | Uses different text for speech and for the balloon                                                                          |
| `\Mrk=number\`               | Bookmark. A `bookmark` event fires when speech reaches it                                                                   |
| `\Lst\`                      | Repeats the previous utterance (use it on its own; bookmarks aren't repeated)                                               |
| `\Emp\`                      | Emphasizes the next word (browsers can't truly emphasize, so it's read slightly slower and higher)                          |
| `\Chr=Whisper\`              | Whispers (not possible in browsers, so it's read quietly). `\Chr=Normal\` or `\Rst\` switches back. `Monotone` does nothing |
| `\Ctx=…\`                    | Context (how symbols and abbreviations are read). Left to the browser, so the tag is just removed                           |

- As in the original, `think()` only uses `\Mrk\` and removes other tags (`think(text, { voice: true })` uses all tags).
- The balloon shows the text with the tags removed.

### SAPI 5 XML tags

SAPI 5 XML tags are supported too (an msagent.js addition). They can be mixed with tags like `\Spd\`.

```js
agent.speak('I\'ll speak <rate absspeed="-5">slowly</rate>.<silence msec="500"/> <emph>This</emph> is important.');
agent.speak('Call <spell>ABC</spell>. <lang langid="411">こんにちは</lang> <bookmark mark="done"/>');
agent.on("bookmark", (e) => console.log(e.detail.mark)); // → "done" (e.detail.id is NaN)
```

| Tag                                                                           | Meaning                                                                                             |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `<rate absspeed="-10–10">` / `<rate speed="…">`                               | Speed (relative to the base speed / to the current speed; 10 is 3×, -10 is 1/3)                     |
| `<pitch absmiddle="-10–10">` / `<pitch middle="…">`                           | Pitch (10 is 2×, -10 is 1/2)                                                                        |
| `<volume level="0–100">`                                                      | Volume                                                                                              |
| `<emph>`                                                                      | Emphasis (like `\Emp\`, read slightly slower and higher)                                            |
| `<spell>`                                                                     | Reads one character at a time (the balloon shows the text as-is)                                    |
| `<silence msec="ms"/>`                                                        | Pauses                                                                                              |
| `<bookmark mark="name"/>`                                                     | Bookmark. A `bookmark` event fires when speech reaches it (the name doesn't have to be a number)    |
| `<sub alias="spoken">displayed</sub>` / `<map alias="spoken">displayed</map>` | Uses different text for speech and for the balloon (like `\Map\`; `<sub>` is from SSML)             |
| `<lang langid="411">`                                                         | Language (a Windows language ID, in hex)                                                            |
| `<voice required="Gender=Female;Language=411">`                               | Voice gender and language (checks `optional` if not in `required`; `Name`, `Age`, etc. are ignored) |
| `<pron>` / `<context>` / `<partofsp>` / `<sapi>` / `<p>` / `<s>`              | Left to the browser, so only the tags are removed (the enclosed text is read)                       |
| `<!-- comment -->`                                                            | Removed (not read or shown; left as text if unclosed)                                               |

- `<rate>` `<pitch>` `<volume>` `<emph>` `<spell>` `<lang>` `<voice>` apply only to their contents and revert when closed (they can be nested). A self-closing form such as `<rate speed="5"/>` applies until the enclosing tag closes, or to the end of the text.
- Unknown tags (such as `<b>`) are left as text.
- Character references such as `&lt;` and `&amp;` are decoded only in text that contains SAPI 5 tags.
- `think()` only uses `<bookmark>` and removes other tags.

To read and show the text exactly as written, without tags, set `agent.tags = false` (or `msagent.load({ name, tags: false })` at load time). For a single call, use `speak(text, { tags: false })` / `think(text, { tags: false })`. `\Lst\` then becomes plain text too. Picking one of `"A|B|C"` isn't a tag, so it still works.

### Linguistically enhanced sound files (.lwv)

`.lwv` files made with the original Linguistic Information Sound Editing Tool (WAV files with word and phoneme timings added) can also be spoken with `speak(text, { url })`.

```js
agent.speak("", { url: "hello.lwv" }); // with empty text, the balloon shows the words stored in the file
agent.speak("Hello!", { url: "hello.lwv" }); // the balloon shows text
```

- The mouth shape is chosen from the phonemes rather than the volume (30 times per second, using the same phoneme-to-mouth table as Microsoft Agent 2.0).
- The balloon text follows the word timings (if `text` has a different number of words than the file, it's revealed gradually over the length of the audio).
- Words are decoded using the character set of the file's language ID (e.g. Shift_JIS for Japanese).
- To read only the contents, use `readLwv(arrayBuffer)` (words, phonemes, and language ID).

### Language

`.acs` files contain the name and description for each language (about 30 languages for the Office characters).

```js
agent.name; // best match for the browser language
agent.language = "zh-TW"; // agent.name / agent.description are now in Traditional Chinese
agent.character.getName("de"); // get it for a specific language (BCP 47)
agent.character.getDescription(0x0411); // a Windows language ID works too
agent.character.languages; // languages included (e.g. ["en", "ja-JP", "zh-TW", …])
```

- If the requested language isn't available, it falls back to another region of the same language → English → the first one in the file. `.act` files have no per-language names, so the name is always the same.
- Setting `agent.language` also sets the language for speech and the balloon (like the original LanguageID). If not set, the speech language is guessed from the text (Japanese if it contains kana or kanji, English otherwise).
- As in the original, the speech voice is chosen by matching language first, then gender. Browser voices don't expose gender, so it's guessed from the voice name (Haruka, Ichiro, David, etc.). Age isn't available from the browser, so it isn't used.
- The voice speed and pitch come from the character file ([Character data](#character-data)).

### Muting all characters

`msagent.audioOutput` lets you mute all characters at once (the original AudioOutput. In the original it reflects the user's settings and is read-only; here you can change it). In ESM, it's also available as `import { audioOutput } from "@argynnini/msagent.js"`.

```js
msagent.audioOutput.enabled = false; // no voice for any character (balloon and mouth movement only)
msagent.audioOutput.soundEffects = false; // no sound effects for any character
msagent.audioOutput.status; // 0: available / 1: can't output audio / 3: listening and hearing speech / 4: speaking aloud / 5: listening and waiting for speech
```

## Interaction

Characters can be dragged around, and double-clicking calls `animate()`. Transparent areas (around the character) aren't clickable; clicks pass through to the page underneath.

### Events

Listen with `agent.on(type, listener)` (`agent` is an `EventTarget`, so `addEventListener` works too). Details are in `event.detail`.

```js
agent.on("click", (e) => agent.speak(`You clicked me at (${e.detail.x}, ${e.detail.y})`));
agent.on("dblclick", (e) => e.preventDefault()); // don't animate() on double-click
agent.on("animationend", (e) => console.log(e.detail.name));
```

| Event                               | When                                                                                                                                                               | `detail`                                                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `click` / `dblclick`                | The character's image or the taskbar icon was clicked (not after a drag)                                                                                           | `x`, `y`, `button` (`"left"` / `"middle"` / `"right"`), `shift`, `ctrl`, `alt`, `source` (`"character"` / `"taskbarIcon"`), `originalEvent`                                     |
| `dragstart` / `dragend`             | Started / finished dragging                                                                                                                                        | `x`, `y` (the character's top-left)                                                                                                                                             |
| `move`                              | Moved                                                                                                                                                              | `x`, `y`, `by` (`"drag"` / `"moveTo"` / `"reposition"`)                                                                                                                         |
| `show` / `hide`                     | Appeared / disappeared                                                                                                                                             | `cause` (`"program"` / `"user"`)                                                                                                                                                |
| `requeststart` / `requestcomplete`  | A request started / finished                                                                                                                                       | `request`                                                                                                                                                                       |
| `animationstart` / `animationend`   | An animation started / ended                                                                                                                                       | `name`, `idle` (whether it's an idle animation)                                                                                                                                 |
| `speakstart` / `speakend`           | Started / finished speaking (also when cut short; also fired for `think()`)                                                                                        | `text`, `thought` (whether it's `think()`)                                                                                                                                      |
| `bookmark`                          | Speech reached a bookmark (`\Mrk=number\` or `<bookmark/>`; also fired for `think()`)                                                                              | `id` (the number; `NaN` for a non-numeric `<bookmark>` name), `mark` (the text as written)                                                                                      |
| `balloonshow` / `balloonhide`       | The word balloon was shown / closed                                                                                                                                | None                                                                                                                                                                            |
| `idlestart` / `idlecomplete`        | Entered / left the idle state (the next request started)                                                                                                           | None                                                                                                                                                                            |
| `activateinput` / `deactivateinput` | Became / stopped being the frontmost character (which receives clicks and voice commands). When it hides or is destroyed, input moves to the frontmost visible one | None                                                                                                                                                                            |
| `command`                           | A command was chosen from the popup menu or by voice                                                                                                               | `name`, `source` (`"menu"` / `"voice"`), `confidence` (0–100), `voice` (recognized text), `count` (number of matching commands), `alternatives` (second and third best matches) |
| `listenstart` / `listencomplete`    | Started / stopped listening                                                                                                                                        | `mode` (`"program"` / `"key"`) / `cause` (`"program"` / `"timeout"` / `"key"` / `"finished"` / `"error"`)                                                                       |
| `helpcomplete`                      | Something was chosen in help mode ([Help mode](#help-mode))                                                                                                        | `name`, `cause`, `helpContextId`                                                                                                                                                |
| `resize`                            | The size changed                                                                                                                                                   | `width`, `height`, `scale`                                                                                                                                                      |

- Calling `preventDefault()` on `dblclick` prevents `animate()`.
- A `move` event with `by` set to `"reposition"` means the browser window got smaller and the character was moved back inside it.
- Separate return animations (such as `MoveRightReturn`) fire their own `animationstart` / `animationend` under their own names.

### Popup menu

Right-clicking the character shows a popup menu, as in the original. It lists the commands added to `agent.commands`, plus "Hide".

```js
agent.commands.add("search", "&Search"); // the character after & is the access key
agent.commands.add("help", "&Help", { enabled: false }); // grayed out
agent.commands.defaultCommand = "search"; // shown in bold
agent.on("command", (e) => {
  if (e.detail.name === "search") agent.speak("What are you looking for?");
});

agent.autoPopupMenu = false; // don't show it on right-click
agent.showPopupMenu(x, y); // show it yourself
```

- The menu can also be operated with the arrow keys, Enter, access keys, and Esc.
- When hidden via "Hide", the `hide` event's `cause` is `"user"`.
- The font can be changed with `agent.commands.fontName` / `fontSize` (in points), like the original Commands.FontName / FontSize.
- Style it with the classes `.msagent-menu` / `.msagent-menu-item` / `.msagent-menu-separator`.

### Speech recognition

As in the original, users can choose commands by voice. This uses the browser's speech recognition (Web Speech API), so it **works in Chrome, Edge, and Safari, but not in Firefox**.
**Chrome and Edge send audio to online servers (Google / Microsoft) for recognition.** The browser asks for microphone permission the first time.

```js
agent.commands.voiceCaption = "Mail"; // name shown in the listening tip
agent.commands.add("check", "&Check mail", { voice: "[...] check [my] (mail | email) [...]" });
agent.commands.add("send", "&Send", { voice: "[please] send [the] mail", voiceCaption: "Send" });
agent.on("command", (e) => {
  if (e.detail.name === "check") agent.speak("Opening your mail.");
  if (e.detail.source === "voice" && e.detail.count === 0) agent.speak("Sorry, I didn't catch that.");
});

button.onclick = () => agent.listen(true); // listen for 10 seconds (stops after one utterance)
msagent.load({ name: "Merlin", listeningKey: "ScrollLock" }); // listen while the key is held down (the original Listening key)
```

`listen(true)` listens for 10 seconds and stops after one utterance. `listen(false)` stops listening. Returns `false` if speech recognition isn't available.
By default, releasing the listening key stops listening immediately. Set `listeningKeyTimeout` to a number of seconds to keep listening that long after the key is released; if the user is mid-utterance at that point, it waits until they finish (the original defaults to 2 seconds).

The `voice` syntax is the same as the original. Browser speech recognition returns free-form text, so msagent.js matches the recognized text against the grammar.
Differences in case, full-width vs. half-width characters, katakana vs. hiragana, punctuation, and whitespace are ignored.

| Syntax           | Meaning                                                                       | Example                           |
| ---------------- | ----------------------------------------------------------------------------- | --------------------------------- |
| `[ ]`            | Optional words                                                                | `hello [there]`                   |
| `( \| )`         | One of the alternatives                                                       | `(hello \| hi)`                   |
| `*` / `+`        | Zero or more / one or more repetitions of the preceding word or group         | `please* try this`, `(New York)+` |
| `...`            | Anything may be said here                                                     | `[...] check mail [...]`          |
| `display\spoken` | Display form and spoken form; either one matches (for Japanese, `kana\kanji`) | `1st\first`, `けんさく\検索`      |

- **Recognition language** is `agent.language` (or the browser language if not set).
- **Confidence:** `confidence` in the `command` event is the browser's confidence (0–1) scaled to 0–100. If it's at or below a command's `confidence`, the listening tip shows its `confidenceText` (same as the original).
- **Listening key:** only the frontmost character listens. Pressing the key plays the Listening state animation, and the Hearing state animation once speech is detected (without interrupting requests or speech in progress).
- **Listening tip:** while listening, a tip such as "-- Merlin is listening --" or "Heard "check mail"" appears below the character. Style it with the class `.msagent-listening-tip`.
- **While hearing:** if the character is told to speak while the user's voice is being heard, it shows only the balloon without speaking aloud (so the user's and the character's voices don't mix; same as the original).
- **Built-in commands:** saying "hide Merlin" hides the character (the `command` event's `name` is `""`, and the `hide` event's `cause` is `"user"`). Disable these with `agent.commands.globalVoiceCommandsEnabled = false`.
- **When unavailable:** `agent.srStatus` tells you why (same values as the original SRStatus). 0: available, 1: no microphone, 4: this browser has no speech recognition or the recognition service can't be reached, 5: microphone or speech recognition not permitted, 6: other. Whether permission is granted isn't known until the first attempt to listen.
- To test a grammar on its own, use `compileVoiceGrammar(voice)` (returns a matching function).

#### Voice Commands Window

A window listing the commands that can currently be spoken (the original Voice Commands Window). It shows this character's voice commands (`voiceCaption`, or `caption` if missing, along with the words to say) and the built-in commands.

- **To open:** choose "Open Voice Commands" in the popup menu (shown only in browsers with speech recognition), say "what can I say" or "show commands" (Japanese phrases work too), or set `agent.commandsWindow.visible = true`
- **To close:** click the × at the top right, say "close commands window" (or its Japanese equivalent), or set `agent.commandsWindow.visible = false`
- It appears at the bottom right of the screen (in the original, next to the taskbar icon). Change its position or style with the class `.msagent-commands-window`.
- If you change the commands while it's open, call `agent.commandsWindow.refresh()` to update it (it's refreshed automatically when listening starts).
- `left` / `top` / `width` / `height` give its position and size on screen (like the original CommandsWindow; 0 when closed).

### Help mode

While `agent.helpModeOn = true`, clicking or dragging the character, or choosing a popup menu item or voice command, fires a `helpcomplete` event instead of `click` / `dragstart` / `command`, and ends help mode (like the original HelpModeOn). The pointer changes to the help cursor.

```js
agent.helpContextId = 1; // help for the character itself
agent.commands.add("search", "&Search", { helpContextId: 2 });
agent.on("helpcomplete", (e) => showHelp(e.detail.helpContextId));
helpButton.onclick = () => (agent.helpModeOn = true);
```

- The original opens a Windows help file (HelpFile), which browsers can't do, so `helpContextId` is passed in the event instead. Use it to show help in your app.
- `helpcomplete`'s `cause` is one of `"character"` / `"command"` / `"hide"` / `"openCommandsWindow"` / `"closeCommandsWindow"`.
- The popup menu can still be opened in help mode (if `autoPopupMenu` is `false`, right-clicking also counts as help).
- Turning help mode off with `helpModeOn = false` doesn't fire `helpcomplete`.

## Appearance

### Size

```js
agent.scale = 2; // 2× (scaled up as crisp pixel art)
agent.width = 64; // 64px wide (keeps the aspect ratio; like the original Width)
agent.height; // current displayed height (px)
```

Resizing keeps the character's feet (bottom center) in place.

### Word balloon

The balloon's colors, font, and width come from the character file's settings (set in the Character Editor).
`agent.balloonStyle` lets you override just the properties you want on top of them.

```js
agent.balloonStyle = { background: "#222222", foreground: "#ffffff", fontSize: 16 };
agent.balloonStyle = { ...agent.balloonStyle, border: "#1e5aa8" }; // add to the current style
agent.balloonStyle = undefined; // back to the character file's settings
msagent.load({ name: "Merlin", balloon: { fontFamily: "Tahoma, sans-serif" } }); // set at load time
```

| Property                                            | Description                                                                                                                             |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `background` / `foreground` / `border`              | Background, text, and border colors (CSS colors)                                                                                        |
| `fontFamily` / `fontSize` / `fontWeight` / `italic` | Font (`fontSize` in px, `fontWeight` such as 400 / 700)                                                                                 |
| `underline` / `strikethrough`                       | Underline / strikethrough                                                                                                               |
| `charsPerLine`                                      | Characters per line (sets the balloon width)                                                                                            |
| `lines`                                             | Number of lines (the height when `sizeToText` is `false`)                                                                               |
| `width` / `height`                                  | Balloon width / height (px, including border and padding). Takes precedence over `charsPerLine` / `lines` (an msagent.js addition)      |
| `enabled`                                           | Whether to use the balloon. If `false`, `speak` uses voice only and `think` shows nothing                                               |
| `sizeToText`                                        | Whether the height fits the text. If `false`, the height is fixed to `lines` lines and overflow scrolls up                              |
| `autoHide`                                          | Whether to close automatically after speaking. If `false`, stays open until the next `speak` / `think`, `hide`, or a click or drag      |
| `autoPace`                                          | Whether to reveal words gradually as they're spoken (follows the mouth movement even without voice). If `false`, shows all text at once |

- The defaults for `enabled` / `sizeToText` / `autoHide` / `autoPace` also come from the character file (the Word Balloon page of the Character Editor).
- Reading `balloonStyle` returns the style currently in use (the file's settings plus your overrides). Characters without settings (such as .act) start from `DEFAULT_BALLOON_STYLE` (pale yellow with a black border).
- When `height` is set, overflow also scrolls up.

### CSS

Use CSS for things `balloonStyle` doesn't cover, such as rounded corners and shadows (e.g. `.msagent-balloon { border-radius: 12px; }`). Setting `background` and the like directly in your page's CSS takes precedence over `balloonStyle`.

| Class                                                                                         | Element               |
| --------------------------------------------------------------------------------------------- | --------------------- |
| `.msagent`                                                                                    | Character             |
| `.msagent-balloon` / `.msagent-tip` / `.msagent-content`                                      | Balloon / tail / text |
| `.msagent-top-left` / `.msagent-top-right` / `.msagent-bottom-left` / `.msagent-bottom-right` | Balloon placement     |
| `.msagent-menu` / `.msagent-menu-item` / `.msagent-menu-separator`                            | Popup menu            |
| `.msagent-listening-tip`                                                                      | Listening tip         |
| `.msagent-commands-window`                                                                    | Voice Commands Window |

### Character data

`agent.character` exposes the settings stored in the character file.

```js
(agent.character.width, agent.character.height); // original size (px)
agent.character.guid; // "{4E574F44-B521-11D0-9E9A-00C04FD7081F}"
agent.character.voice; // { speed: 156, pitch: 50, language: "en-US", gender: "male", age: 30, style: "Business", engine: "{…}", mode: "{…}" }
agent.character.trayIcon; // small tray icon (.acs / .acf only). Use imageToDataUrl(icon) for an <img> or favicon
agent.character.balloon; // { background: "#ffffe1", foreground: "#000000", border: "#000000", fontFamily: "MS Sans Serif", fontSize: 13, lines: 2, charsPerLine: 32, … }
```

The voice `speed` (words per minute) and `pitch` (Hz) are also used for `speak()`. Missing fields are `undefined` (many Office Assistants have no voice settings).

## Properties

**Same as the original**

| Property                                                | Description                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `visible`                                               | Whether the character is shown (read-only)                                                                                                                                                                                                                                                                                                                                           |
| `left` / `top`                                          | Position on screen (px). Assigning moves the character there immediately                                                                                                                                                                                                                                                                                                             |
| `idleOn`                                                | Whether to play idle animations automatically                                                                                                                                                                                                                                                                                                                                        |
| `moveCause` / `visibilityCause`                         | Cause of the last move / the last show or hide                                                                                                                                                                                                                                                                                                                                       |
| `balloonVisible`                                        | Whether the balloon is shown. Assigning `false` closes it (after it finishes reading, if speaking). `true` shows the last text again                                                                                                                                                                                                                                                 |
| `extraData` / `version` / `guid`                        | Extra text added by the author / file version / GUID                                                                                                                                                                                                                                                                                                                                 |
| `originalWidth` / `originalHeight`                      | Original size (px)                                                                                                                                                                                                                                                                                                                                                                   |
| `speed` / `pitch`                                       | Speech speed (words/min) / pitch (Hz), from the character file (read-only)                                                                                                                                                                                                                                                                                                           |
| `ttsModeId`                                             | Voice used for speech. Assign a `voiceURI` or name from `speechSynthesis.getVoices()` to use that voice (except in parts where tags change the language or gender). `undefined` restores automatic selection. Reading returns the current voice's `voiceURI` (`""` if not speaking aloud or no voice matches)                                                                        |
| `srModeId`                                              | Speech recognition language (the original SRModeID; browsers can't choose a recognition engine, so this picks the language). Assign e.g. `"en-US"` to listen in a different language from speech. `undefined` restores the speech language. Takes effect the next time listening starts. Reading returns the current listening language (`""` if speech recognition isn't available) |
| `soundEffectsOn`                                        | Whether to play sound effects (same as `sound`)                                                                                                                                                                                                                                                                                                                                      |
| `name` / `description`                                  | Name / description (in the `language` language; see [Language](#language)). Assigning changes them; `undefined` restores the file's values                                                                                                                                                                                                                                           |
| `active`                                                | Whether the character is frontmost                                                                                                                                                                                                                                                                                                                                                   |
| `commands`                                              | Popup menu and voice commands ([Popup menu](#popup-menu))                                                                                                                                                                                                                                                                                                                            |
| `commandsWindow`                                        | Voice Commands Window ([Voice Commands Window](#voice-commands-window))                                                                                                                                                                                                                                                                                                              |
| `autoPopupMenu`                                         | Whether right-clicking shows the popup menu                                                                                                                                                                                                                                                                                                                                          |
| `listening` / `srStatus`                                | Whether listening / whether voice input is available ([Speech recognition](#speech-recognition))                                                                                                                                                                                                                                                                                     |
| `listeningKey` / `listeningKeyTimeout` / `listeningTip` | Listening key / seconds to keep listening after the key is released / whether to show the listening tip                                                                                                                                                                                                                                                                              |
| `helpModeOn` / `helpContextId`                          | [Help mode](#help-mode)                                                                                                                                                                                                                                                                                                                                                              |
| `raiseRequestErrors`                                    | Whether failed requests throw                                                                                                                                                                                                                                                                                                                                                        |
| `taskbarIcon`                                           | Whether to show a taskbar icon (bottom right of the screen). Hovering shows the name, clicking shows the character (or brings it to the front if visible), and right-clicking opens a menu (only "Show" and the Voice Commands Window while hidden)                                                                                                                                  |

**Added by msagent.js**

| Property                     | Description                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `language`                   | Language for the name, description, and speech ([Language](#language))            |
| `scale` / `width` / `height` | Size ([Size](#size))                                                              |
| `balloonStyle`               | Word balloon style ([Word balloon](#word-balloon))                                |
| `speaking`                   | Whether currently speaking                                                        |
| `sound` / `voice`            | Whether to play sound effects / whether `speak()` reads aloud                     |
| `tags`                       | Whether to process speech output tags ([Speech output tags](#speech-output-tags)) |
| `on()` / `off()`             | Adds / removes an event listener                                                  |
| `hitTest(clientX, clientY)`  | Whether a point is over the character's image                                     |
| `element` / `canvas`         | The character element (`div.msagent`) / the canvas it's drawn on                  |
| `character` / `player`       | The parsed character file / the animation player                                  |

## Notes

- Character files are not included. Get them from those bundled with Office 2000 / XP / 2003, or from sites such as [Agentpedia](https://agentpedia.tmafe.com/). Copyright in each character belongs to its respective owner.
- Due to browser autoplay restrictions, sound effects won't play until the page has been clicked once.
- Speech uses the voices installed in the browser and OS.
- Speech recognition in Chrome and Edge sends audio to online servers ([Speech recognition](#speech-recognition)).

## Development

```sh
npm install
npm run dev     # demo in example/ (pick a character file and try it out)
npm run build   # outputs ESM, <script> build, and type definitions to dist/
npm test        # tests (see below)
```

### Tests

Tests use [Playwright](https://playwright.dev/) and are split into three projects.

| Project   | What it covers                                                                                                                                  |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `unit`    | Things that don't need a browser (tag parsing, language and voice selection, mouth shapes, the request queue, loading character files and .lwv) |
| `browser` | Runs characters on a test page (`tests/harness`): states, requests, speaking, thinking, balloons, mouse, menus, size, idle animations, and more |
| `demo`    | Drives the demo page in `example`                                                                                                               |

Character files aren't included, so set the `MSAGENT_CHARACTERS` environment variable to where they are (separate multiple directories with `;` on Windows or `:` on macOS / Linux). The tests use `Merlin.acs`, `finfin.acs`, `CLIPPIT.ACS`, `DOLPHIN.ACS`, `ROCKY.act`, `dolphin.act`, `Genie.acf` (with `Show.aca` and `Greet.aca`), `robby.acf`, and Merlin's `GestureUp.aca`; tests that need a missing file are skipped.

```sh
# Windows (PowerShell)
$env:MSAGENT_CHARACTERS = "C:\agents;C:\Users\me\Downloads"; npm test
# macOS / Linux
MSAGENT_CHARACTERS=~/agents npm test
npm run test:unit   # only the tests that don't need a browser (fast)
```

Tests use your installed Chrome (change it with e.g. `PW_CHANNEL=msedge`; to use Playwright's own browser, run `npx playwright install chromium` and then set `PW_CHANNEL=chromium`).

## License

[MIT](LICENSE). Character files (.acs / .acf / .aca / .act) are not included and are not covered by this license (copyright belongs to their respective owners).
