import msagent, { ActCharacter, imageToDataUrl, type Agent } from "../src";

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
    sound: pressed(soundButton),
    voice: pressed(voiceButton),
    successCb: (a) => {
      agent = a;
      // コンソールから試せるように (例: agent.moveTo(100, 100))
      (window as unknown as { agent: Agent }).agent = a;
      placeOnStage(a);
      a.show();
      toggle(visibleButton, true);
      a.speak(`${a.name ?? "キャラクター"}です。ドラッグで動かせます。ダブルクリックすると、何か動きます。`);
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
  const format = a.character instanceof ActCharacter ? "ACT" : "ACS";
  nameLabel.replaceChildren();
  const strong = document.createElement("strong");
  strong.textContent = a.name ?? fileName.replace(/\.ac[st]$/i, "");
  const badge = document.createElement("span");
  badge.className = "format";
  badge.textContent = format;
  nameLabel.append(strong, badge, ` · ${a.character.width}×${a.character.height} · ${a.animations().length} アニメーション`);
  nameLabel.title = `${fileName} (画像 ${a.character.width}×${a.character.height} px)`;

  const icon = a.character.trayIcon && imageToDataUrl(a.character.trayIcon);
  pickIcon.hidden = !icon;
  pickEmoji.hidden = !!icon;
  if (icon) pickIcon.src = icon;

  emptyButton.hidden = true;
  stage.classList.add("loaded");
  stageHint.textContent = "キャラクターは画面の上に浮かんでいます。ドラッグで動かし、ダブルクリックでおまかせの動き。";
  for (const el of document.querySelectorAll<HTMLElement>(".needs-agent")) el.hidden = false;

  names = a.animations().sort((x, y) => x.localeCompare(y));
  filter.value = "";
  renderList();
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
  else agent.hide();
};
$<HTMLFormElement>("speak").onsubmit = (e) => {
  e.preventDefault();
  if (!agent) return;
  agent.speak($<HTMLInputElement>("text").value.trim() || selfIntroduction(agent));
};

/** 空欄のまま「話す」を押したときの自己紹介: キャラクターファイルの紹介文 (無ければ名前だけ) */
function selfIntroduction(a: Agent): string {
  const description = a.character.description?.trim();
  if (description) return description;
  return `こんにちは、${a.name ?? nameLabel.title.replace(/\.ac[st].*$/i, "")}です。`;
}
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
  if (target.closest("a, button, input, label, .seg, pre, .msagent, .msagent-balloon")) return;
  const mode = document.querySelector<HTMLInputElement>('input[name="click"]:checked')?.value;
  if (mode === "none") return;
  showMarker(e.clientX, e.clientY);
  if (mode === "move") {
    // moveTo はキャラクターの左上の位置なので、キャラクターの真ん中がクリックした場所に来るようにずらす
    const { width, height } = agent.element.getBoundingClientRect();
    agent.moveTo(e.clientX - width / 2, e.clientY - height / 2);
  } else {
    agent.gestureAt(e.clientX, e.clientY);
  }
});

function showMarker(x: number, y: number) {
  const marker = document.createElement("div");
  marker.className = "marker";
  marker.style.left = `${x}px`;
  marker.style.top = `${y}px`;
  marker.addEventListener("animationend", () => marker.remove());
  document.body.append(marker);
}
