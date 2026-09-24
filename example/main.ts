import msagent, { type Agent } from "../src";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sound = $<HTMLInputElement>("sound");
const voice = $<HTMLInputElement>("voice");
let agent: Agent | undefined;
let visible = false;

$<HTMLInputElement>("file").addEventListener("change", (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  agent?.destroy();
  // clippy.js と同じ呼び方 (名前の代わりに File も渡せる)
  msagent.load(file, (a) => {
    agent = a;
    // コンソールから試せるように (例: agent.moveTo(100, 100))
    (window as unknown as { agent: Agent }).agent = a;
    a.sound = sound.checked;
    a.voice = voice.checked;
    a.show();
    visible = true;
    a.speak(`${a.name ?? "キャラクター"}です。ダブルクリックすると、何か動きます。`);
    $("list").replaceChildren(
      ...a.animations().sort().map((name) => {
        const b = document.createElement("button");
        b.textContent = name;
        b.onclick = () => a.play(name);
        return b;
      }),
    );
  }, (err) => alert(err));
});

sound.onchange = () => agent && (agent.sound = sound.checked);
voice.onchange = () => agent && (agent.voice = voice.checked);
$<HTMLFormElement>("speak").onsubmit = (e) => {
  e.preventDefault();
  agent?.speak($<HTMLInputElement>("text").value);
};
$("animate").onclick = () => agent?.animate();
$("stop").onclick = () => agent?.stop();
$("toggle").onclick = () => {
  if (!agent) return;
  if (visible) agent.hide();
  else agent.show();
  visible = !visible;
};

// 画面をクリックした場所へ移動する / そこを指す (ボタン・入力欄・キャラクターの上は除く)
document.addEventListener("click", (e) => {
  if (!agent || !visible) return;
  const target = e.target as Element;
  if (target.closest("button, input, label, fieldset, .msagent, .msagent-balloon")) return;
  const mode = document.querySelector<HTMLInputElement>('input[name="click"]:checked')?.value;
  if (mode === "none") return;
  showMarker(e.clientX, e.clientY);
  if (mode === "move") {
    // moveTo はキャラクターの左上の位置なので、キャラクターの真ん中がクリックした場所に来るようにずらす
    const { width, height } = agent.element.getBoundingClientRect();
    agent.moveTo(e.clientX - width / 2, e.clientY - height / 2, Number($<HTMLInputElement>("duration").value) || 0);
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
