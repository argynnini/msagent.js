import msagent, { ActCharacter, imageToDataUrl, type Agent, type AgentEventMap } from "../src";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $("drop");
const fileInput = $<HTMLInputElement>("file");
const nameLabel = $("name");
const pickEmoji = $("pick-emoji");
const pickIcon = $<HTMLImageElement>("pick-icon");
const stageHint = $("stage-hint");
const emptyButton = $("empty");
const soundButton = $("sound");
const voiceButton = $("voice");
const visibleButton = $("visible");
const filter = $<HTMLInputElement>("filter");
const list = $("anim-list");
const langSelect = $<HTMLSelectElement>("lang");
const eventList = $("events");
const scaleInput = $<HTMLInputElement>("scale");
const scaleValue = $("scale-value");
const infoList = $("info");
const durationInput = $<HTMLInputElement>("duration");

let agent: Agent | undefined;
let names: string[] = [];

const pressed = (button: HTMLElement) => button.getAttribute("aria-pressed") === "true";
function toggle(button: HTMLElement, on = !pressed(button)): boolean {
  button.setAttribute("aria-pressed", String(on));
  return on;
}

// --- 読み込み ---

function open(file: File) {
  agent?.destroy();
  agent = undefined;
  nameLabel.textContent = `${file.name} を読み込み中…`;
  msagent.load({
    name: file,
    scale: Number(scaleInput.value) / 100,
    sound: pressed(soundButton),
    voice: pressed(voiceButton),
    successCb: (a) => {
      agent = a;
      // コンソールから試せるように (例: agent.moveTo(100, 100))
      (window as unknown as { agent: Agent }).agent = a;
      watchEvents(a);
      addCommands(a);
      placeOnStage(a);
      a.show();
      toggle(visibleButton, true);
      showCharacter(a, file.name);
    },
    failCb: (error) => {
      nameLabel.textContent = "読み込めませんでした";
      stageHint.textContent = `読み込めませんでした: ${error instanceof Error ? error.message : String(error)}`;
    },
  });
}

/** キャラクターは画面に浮かぶ (position: fixed) ので、最初はステージの真ん中に置く */
function placeOnStage(a: Agent) {
  const r = stage.getBoundingClientRect();
  a.element.style.left = `${r.left + r.width / 2 - a.character.width / 2}px`;
  // 下端の案内の分だけ、少し上に
  a.element.style.top = `${r.top + (r.height - 40) / 2 - a.character.height / 2 + 30}px`;
}

function showCharacter(a: Agent, fileName: string) {
  renderName(a, fileName);
  renderLanguages(a);

  const icon = a.character.trayIcon && imageToDataUrl(a.character.trayIcon);
  pickIcon.hidden = !icon;
  pickEmoji.hidden = !!icon;
  if (icon) pickIcon.src = icon;

  emptyButton.hidden = true;
  stage.classList.add("loaded");
  stageHint.textContent = "キャラクターは画面の上に浮かんでいます。ドラッグで動かし、ダブルクリックでおまかせの動き。";
  for (const el of document.querySelectorAll<HTMLElement>(".needs-agent")) el.hidden = false;
  // 言語ごとの名前が無いキャラクター (ACT など) は、言語を選べない
  langSelect.hidden = a.character.languages.length < 2;
  eventList.replaceChildren();
  renderScale(a);
  renderInfo(a);
  renderBalloonStyle(a);

  names = a.animations().sort((x, y) => x.localeCompare(y));
  filter.value = "";
  renderList();
}

function renderName(a: Agent, fileName: string) {
  const format = a.character instanceof ActCharacter ? "ACT" : "ACS";
  nameLabel.replaceChildren();
  const strong = document.createElement("strong");
  strong.textContent = a.name ?? fileName.replace(/\.ac[st]$/i, "");
  const badge = document.createElement("span");
  badge.className = "format";
  badge.textContent = format;
  nameLabel.append(strong, badge, ` · ${a.character.width}×${a.character.height} · ${a.animations().length} アニメーション`);
  nameLabel.title = `${fileName} (画像 ${a.character.width}×${a.character.height} px)`;
  nameLabel.dataset.file = fileName;
}

function renderScale(a: Agent) {
  scaleValue.textContent = `${Math.round(a.scale * 100)}% (${a.width}×${a.height})`;
}

scaleInput.oninput = () => {
  if (!agent) return;
  agent.scale = Number(scaleInput.value) / 100;
  renderScale(agent);
};

/** キャラクターファイルに入っている設定を並べる */
function renderInfo(a: Agent) {
  const c = a.character;
  const v = c.voice;
  const b = c.balloon;
  const gender = { neutral: "指定なし", female: "女性", male: "男性" } as const;
  const rows: [string, string | (string | Node)[]][] = [
    ["画像", `${c.width}×${c.height} px · ${c.imageCount} 枚`],
    ["GUID", c.guid ? [code(c.guid)] : "なし"],
    [
      "声",
      Object.keys(v).length === 0
        ? "設定なし"
        : [
            v.speed ? `${v.speed} 語/分` : "速さ: エンジン任せ",
            v.pitch ? `${v.pitch} Hz` : "高さ: エンジン任せ",
            v.language,
            v.gender && gender[v.gender],
            v.age && `${v.age} 歳`,
            v.style,
          ].filter(Boolean).join(" · "),
    ],
    ["音声エンジン", v.engine ? [code(v.engine)] : "なし"],
    [
      "吹き出し",
      b
        ? [
            swatch(b.background), `背景 ${b.background}  `, swatch(b.foreground), `文字 ${b.foreground}  `, swatch(b.border), `縁 ${b.border}`,
            document.createElement("br"),
            `${b.fontFamily} ${b.fontSize}px${b.fontWeight >= 700 ? " 太字" : ""}${b.italic ? " 斜体" : ""} · ${b.lines} 行 × ${b.charsPerLine} 文字`,
            document.createElement("br"),
            [
              b.enabled ? "使う" : "使わない",
              b.sizeToText ? "高さは文に合わせる" : "行数で固定",
              b.autoHide ? "自動で閉じる" : "出したまま",
              b.autoPace ? "少しずつ出す" : "一度に出す",
            ].join(" · "),
          ]
        : "設定なし",
    ],
    ["言語", c.languages.length ? `${c.languages.length} 言語` : "1 つだけ"],
  ];
  infoList.replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      if (typeof v === "string") dd.textContent = v;
      else dd.append(...v);
      return [dt, dd];
    }),
  );
}

// --- 吹き出しの見た目 (agent.balloonStyle) ---

const styleInputs = [...document.querySelectorAll<HTMLInputElement>("#bstyle input")];

/** いまの見た目を、入力欄に入れる */
function renderBalloonStyle(a: Agent) {
  const style = a.balloonStyle;
  for (const input of styleInputs) {
    const key = input.dataset.key!;
    if (key === "bold") input.checked = style.fontWeight >= 700;
    else if (input.type === "checkbox") input.checked = Boolean(style[key as keyof typeof style]);
    else input.value = String(style[key as keyof typeof style]);
  }
}

/** 入力欄の値を、agent.balloonStyle に入れる (キャラクターファイルの設定の上に重なる) */
function applyBalloonStyle() {
  if (!agent) return;
  const style: Record<string, string | number | boolean> = {};
  for (const input of styleInputs) {
    const key = input.dataset.key!;
    if (key === "bold") style.fontWeight = input.checked ? 700 : 400;
    else if (input.type === "checkbox") style[key] = input.checked;
    else if (input.type === "number") {
      if (Number.isFinite(input.valueAsNumber)) style[key] = input.valueAsNumber;
    } else style[key] = input.value;
  }
  agent.balloonStyle = style;
}

/** 吹き出しが出ていなければ、見本を出す */
function previewBalloon() {
  if (agent && !agent.speaking) agent.speak("吹き出しの見た目を変えました。");
}

for (const input of styleInputs) {
  input.addEventListener("input", applyBalloonStyle);
  input.addEventListener("change", previewBalloon);
}
$("bstyle-reset").onclick = () => {
  if (!agent) return;
  agent.balloonStyle = undefined;
  renderBalloonStyle(agent);
  previewBalloon();
};

function code(text: string) {
  const el = document.createElement("code");
  el.textContent = text;
  return el;
}

function swatch(color: string) {
  const el = document.createElement("span");
  el.className = "swatch";
  el.style.background = color;
  return el;
}

/** 名前・紹介文の言語の選択肢: 「ブラウザの言語」+ キャラクターファイルにある言語 */
function renderLanguages(a: Agent) {
  const display = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames([navigator.language], { type: "language" }) : undefined;
  const label = (tag: string) => {
    try {
      return display?.of(tag) ?? tag;
    } catch {
      return tag;
    }
  };
  const auto = new Option(`自動 (${label(navigator.language)})`, "");
  const options = a.character.languages
    .map((tag) => new Option(label(tag), tag))
    .sort((x, y) => x.text.localeCompare(y.text));
  langSelect.replaceChildren(auto, ...options);
  langSelect.value = "";
}

langSelect.onchange = () => {
  if (!agent) return;
  agent.language = langSelect.value || undefined;
  renderName(agent, nameLabel.dataset.file ?? "");
};

/** 時間に合わせたあいさつ */
function greeting(): string {
  const h = new Date().getHours();
  return h < 10 ? "おはようございます！" : h < 18 ? "こんにちは！" : "こんばんは！";
}

/** 右クリックのメニューに項目を足す (agent.commands) */
function addCommands(a: Agent) {
  // voice: 声で選ぶときの言葉 (「🎤 聞く」のあとに言う)
  a.commands.add("hello", "あいさつ(&G)", { voice: "[...] (こんにちは | こんばんは | おはよう | hello | hi) [...]" });
  a.commands.add("animate", "おまかせの動き(&A)", { voice: "[...] (おまかせ | なにか して | 何か して | animate) [...]" });
  a.commands.add("intro", "自己紹介(&I)", { voice: "[...] (自己紹介 | じこしょうかい | introduce yourself | who are you) [...]" });
  a.commands.add("think", "考える(&T)", { voice: "[...] (考えて | かんがえて | think) [...]" });
  a.commands.add("wave", "手を振る(&W)", { enabled: a.hasAnimation("Wave"), voice: "[...] (手を振って | てをふって | wave) [...]" });
  a.commands.defaultCommand = "intro";
  a.on("command", (e) => {
    if (e.detail.name === "hello") a.speak(greeting());
    else if (e.detail.name === "animate") a.animate();
    else if (e.detail.name === "intro") a.speak(selfIntroduction(a));
    else if (e.detail.name === "think") a.think(selfIntroduction(a));
    else if (e.detail.name === "wave") a.play("Wave");
  });
}

/** 届いたイベントを、プレイヤーの下に新しい順で出す */
function watchEvents(a: Agent) {
  const types: (keyof AgentEventMap)[] = [
    "click", "dblclick", "dragstart", "dragend", "move", "resize", "show", "hide",
    "animationstart", "animationend", "speakstart", "speakend", "bookmark",
    "requeststart", "requestcomplete", "balloonshow", "balloonhide", "idlestart", "idlecomplete", "command",
    "listenstart", "listencomplete",
  ];
  // 聞いている間は「🎤 聞く」を押した見た目にする
  a.on("listenstart", () => toggle($("listen"), true));
  a.on("listencomplete", () => toggle($("listen"), false));
  for (const type of types) {
    a.on(type, (e) => {
      const detail = { ...(e.detail as object) } as Record<string, unknown>;
      delete detail.originalEvent;
      // 命令は、番号・種類・状態だけを出す (agent を含むので、そのままでは文字にできない)
      const request = detail.request as { id: number; type: string; status: string } | undefined;
      if (request) detail.request = `#${request.id} ${request.type} ${request.status}`;
      for (const [k, v] of Object.entries(detail)) if (typeof v === "number") detail[k] = Math.round(v);
      if (typeof detail.text === "string" && detail.text.length > 16) detail.text = `${detail.text.slice(0, 16)}…`;
      const li = document.createElement("li");
      const name = document.createElement("b");
      name.textContent = type;
      li.append(name, ` ${Object.keys(detail).length ? JSON.stringify(detail) : ""}`);
      eventList.prepend(li);
      while (eventList.children.length > 8) eventList.lastElementChild!.remove();
    });
  }
}

function renderList() {
  const q = filter.value.trim().toLowerCase();
  const shown = names.filter((n) => n.toLowerCase().includes(q));
  if (shown.length === 0) {
    const p = document.createElement("div");
    p.className = "anim-empty";
    p.textContent = "見つかりません";
    list.replaceChildren(p);
    return;
  }
  list.replaceChildren(
    ...shown.map((name) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "anim";
      b.role = "listitem";
      b.textContent = name;
      b.title = `agent.play("${name}")`;
      b.onclick = () => agent?.play(name);
      return b;
    }),
  );
  markCurrent();
}

/** 再生中のアニメーションのボタンを目立たせる */
function markCurrent() {
  const current = agent?.player.currentAnimation;
  for (const b of list.querySelectorAll<HTMLButtonElement>(".anim")) {
    b.setAttribute("aria-current", String(b.textContent === current));
  }
}
setInterval(markCurrent, 200);

$("pick").onclick = emptyButton.onclick = () => fileInput.click();
fileInput.onchange = () => {
  const file = fileInput.files?.[0];
  if (file) open(file);
  fileInput.value = "";
};

// ページのどこにドロップしても読み込む (ドラッグ中はステージに受け皿を出す)
let dragDepth = 0;
document.addEventListener("dragenter", (e) => {
  if (!e.dataTransfer?.types.includes("Files")) return;
  dragDepth++;
  document.body.classList.add("dragging");
});
document.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    document.body.classList.remove("dragging");
  }
});
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dragging");
  const file = e.dataTransfer?.files[0];
  if (file) open(file);
});

// --- 操作 ---

soundButton.onclick = () => {
  const on = toggle(soundButton);
  if (agent) agent.sound = on;
};
voiceButton.onclick = () => {
  const on = toggle(voiceButton);
  if (agent) agent.voice = on;
};
visibleButton.onclick = () => {
  if (!agent) return;
  if (toggle(visibleButton)) agent.show();
  // ボタンなので、順番待ち (しゃべっている途中など) を待たずに、すぐ隠す
  else agent.hide(false, undefined, { immediate: true });
};
$<HTMLFormElement>("speak").onsubmit = (e) => {
  e.preventDefault();
  if (!agent) return;
  agent.speak($<HTMLInputElement>("text").value.trim() || selfIntroduction(agent));
};

/** 空欄のまま「話す」を押したときの自己紹介: キャラクターファイルの紹介文 (選んだ言語。無ければ名前だけ) */
function selfIntroduction(a: Agent): string {
  const description = a.description?.trim();
  if (description) return description;
  return `こんにちは、${a.name ?? (nameLabel.dataset.file ?? "").replace(/\.ac[st]$/i, "")}です。`;
}
$("listen").onclick = () => {
  if (!agent) return;
  if (agent.listening) agent.listen(false);
  else if (!agent.listen(true)) agent.speak("このブラウザでは音声認識が使えません (Chrome・Edge・Safari で試してください)");
};
$("think").onclick = () => {
  if (agent) agent.think($<HTMLInputElement>("text").value.trim() || selfIntroduction(agent));
};
$("animate").onclick = () => agent?.animate();
$("stop").onclick = () => agent?.stop();
filter.oninput = renderList;

$("copy").onclick = async (e) => {
  const button = e.currentTarget as HTMLButtonElement;
  try {
    await navigator.clipboard.writeText("npm install msagent.js");
    button.textContent = "コピーしました";
  } catch {
    button.textContent = "コピーできません";
  }
  setTimeout(() => (button.textContent = "コピー"), 1500);
};

// ページをクリックした場所へ移動する / そこを指す (リンク・ボタン・入力欄・キャラクターの上は除く)
document.addEventListener("click", (e) => {
  if (!agent || !pressed(visibleButton)) return;
  const target = e.target as Element;
  // 操作するもの (リンク・ボタン・入力欄・選択肢など) と、プレイヤーの操作パネル (ステージ以外) は除く
  const controls = "a, button, input, select, option, textarea, label, summary, details, pre, [contenteditable]";
  const panels = ".player > :not(.stage)";
  if (target.closest(`${controls}, ${panels}, .msagent, .msagent-balloon, .msagent-menu`)) return;
  const mode = document.querySelector<HTMLInputElement>('input[name="click"]:checked')?.value;
  if (mode === "none") return;
  showMarker(e.clientX, e.clientY);
  if (mode === "move") {
    // moveTo はキャラクターの左上の位置なので、キャラクターの真ん中がクリックした場所に来るようにずらす
    const { width, height } = agent.element.getBoundingClientRect();
    agent.moveTo(e.clientX - width / 2, e.clientY - height / 2, moveDuration());
  } else {
    agent.gestureAt(e.clientX, e.clientY);
  }
});

/** 移動にかける時間 (ms)。空欄や数でなければ既定の 1000 */
function moveDuration(): number {
  const ms = durationInput.valueAsNumber;
  return Number.isFinite(ms) && ms >= 0 ? ms : 1000;
}

// 「移動」のときだけ、時間を入れられるようにする
for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="click"]')) {
  radio.addEventListener("change", () => (durationInput.disabled = radio.value !== "move" || !radio.checked));
}

function showMarker(x: number, y: number) {
  const marker = document.createElement("div");
  marker.className = "marker";
  marker.style.left = `${x}px`;
  marker.style.top = `${y}px`;
  marker.addEventListener("animationend", () => marker.remove());
  document.body.append(marker);
}
