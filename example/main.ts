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
$("move").onclick = () => agent?.moveTo(Math.random() * (innerWidth - 150), Math.random() * (innerHeight - 150));
$("gesture").onclick = () => agent?.gestureAt(0, 0);
$("stop").onclick = () => agent?.stop();
$("toggle").onclick = () => {
  if (!agent) return;
  if (visible) agent.hide();
  else agent.show();
  visible = !visible;
};
