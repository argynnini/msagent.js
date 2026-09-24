import { Agent } from "../src";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $("stage");
const list = $("list");
const balloon = $("balloon");
const sound = $<HTMLInputElement>("sound");
let agent: Agent | undefined;

$<HTMLInputElement>("file").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  agent?.destroy();
  agent = await Agent.load(file, { sound: sound.checked });
  stage.replaceChildren(agent.canvas);
  list.replaceChildren(
    ...agent.animations.sort().map((name) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.className = "link";
      b.textContent = name;
      b.onclick = () => void agent?.play(name);
      li.append(b);
      return li;
    }),
  );
  await agent.show();
});

sound.addEventListener("change", () => {
  if (agent) agent.sound = sound.checked;
});

$<HTMLFormElement>("speak").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!agent) return;
  await agent.speak($<HTMLInputElement>("text").value, { onProgress: (shown) => (balloon.textContent = shown) });
  setTimeout(() => (balloon.textContent = ""), 2000);
});
