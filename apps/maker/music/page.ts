// PROTOTYPE (#129): builds music/out/index.html, the side-by-side listening page, from the run's result*.json files.
// Tracks are blind by default (shuffled letters); scores stay in localStorage and "Copy scores" puts them on the
// clipboard with the real arm and model. Serve it: pnpm -F maker music:listen, then open http://localhost:8129.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { GAMES } from "./run.ts";

const OUT = path.join(import.meta.dirname, "out");

const readJson = (file: string) =>
  existsSync(file) ? JSON.parse(readFileSync(file, "utf-8")) : undefined;

const tracks = Object.keys(GAMES).flatMap((game) =>
  existsSync(path.join(OUT, game))
    ? readdirSync(path.join(OUT, game))
        .filter((name) => existsSync(path.join(OUT, game, name, "result.json")))
        .map((name) => {
          const dir = `${game}/${name}`;
          const [arm] = name;
          // A plays the exact samples the runtime renders (raw PCM, no encoder); B and C the Opus the feed would get.
          const file = (suffix: string) =>
            arm === "a"
              ? `${dir}/music${suffix}.wav`
              : `${dir}/music${suffix}.webm`;
          return {
            edit: readJson(path.join(OUT, game, name, "result-edit.json")),
            first: readJson(path.join(OUT, game, name, "result.json")),
            game,
            id: name,
            live: arm === "a" ? `${dir}/game.html` : undefined,
            liveEdit: arm === "a" ? `${dir}/game-edit.html` : undefined,
            src: file(""),
            srcEdit: file("-edit"),
          };
        })
    : []
);

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Music Source Listening</title>
<style>
:root{--bg:#fafaf7;--fg:#1d1d1b;--muted:#6b6b66;--card:#fff;--line:#e3e2dc;--accent:#3b5bdb;--on:#e7ecff}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe6;--muted:#9a9993;--card:#1f1f1d;--line:#33332f;--accent:#8ea4ff;--on:#25305a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif}
main{max-width:1200px;margin:0 auto;padding:24px 16px 64px}h1{font-size:22px;margin:0 0 4px}
.lede{color:var(--muted);margin:0 0 20px;max-width:70ch}
.bar{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 24px}
button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:6px;padding:5px 10px;cursor:pointer}
button.on{background:var(--on);border-color:var(--accent)}
section{margin:0 0 32px}h2{font-size:17px;margin:0}.brief{color:var(--muted);margin:2px 0 10px;font-size:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:6px}
.name{font-weight:600}.meta{color:var(--muted);font-size:12.5px;font-variant-numeric:tabular-nums}
.row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
select{font:inherit;padding:3px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--fg)}
a{color:var(--accent)}
</style></head><body><main>
<h1>Where does a game's music come from?</h1>
<p class="lede">Five games, one card per music source. Play loops forever; Seam starts 4 s before the end so you hear the wrap. "After" is the follow-up edit. Score each track 1–5 (saved in this browser), then Copy scores and paste them into the session. Cards are blind until you press Reveal.</p>
<div class="bar"><button id="stop">Stop</button><button id="reveal">Reveal sources</button><button id="copy">Copy scores</button><span id="msg" class="meta"></span></div>
<div id="games"></div>
</main>
<script>
const TRACKS = ${JSON.stringify(tracks)};
const GAMES = ${JSON.stringify(GAMES)};
const LABEL = { a: "A · ZzFXM song", b: "B · Node synth", c: "C · Lyria 3 Clip" };
let revealed = false;
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
let ctx, node, playing;
const buffers = {};
const stop = () => { node?.stop(); node = undefined; playing?.classList.remove("on"); playing = undefined; };
const play = async (src, button, seam) => {
  const same = playing === button; stop(); if (same) return;
  ctx ??= new AudioContext();
  buffers[src] ??= await fetch(src).then((r) => { if (!r.ok) throw new Error(src); return r.arrayBuffer(); }).then((b) => ctx.decodeAudioData(b));
  const buffer = buffers[src];
  node = ctx.createBufferSource(); node.buffer = buffer; node.loop = true; node.connect(ctx.destination);
  node.start(0, seam ? Math.max(0, buffer.duration - 4) : 0);
  playing = button; button.classList.add("on");
};
const fmt = (r) => r ? [r.seconds && r.seconds + " s", r.turnSeconds && "turn " + r.turnSeconds + " s", "$" + ((r.modelUsd || 0) + (r.lyriaUsd || 0)).toFixed(3), r.bytesAdded && (r.bytesAdded / 1024).toFixed(1) + " KB song", r.scriptBytes && (r.scriptBytes / 1024).toFixed(1) + " KB script", r.opusBytes && (r.opusBytes / 1024).toFixed(0) + " KB opus", r.renderMs != null && "render " + r.renderMs + " ms", r.label === "edit" && (r.patches ? "patched" : r.writes ? "rewrote" : r.arm === "c" ? "regenerated" : "")].filter(Boolean).join(" · ") : "missing";
const render = () => {
  const root = document.getElementById("games"); root.textContent = "";
  for (const [game, brief] of Object.entries(GAMES)) {
    const tracks = TRACKS.filter((t) => t.game === game);
    if (!tracks.length) continue;
    // A stable shuffle per game, so the letters don't give the source away.
    const order = [...tracks].sort((x, y) => (hash(game + x.id) - hash(game + y.id)));
    const section = document.createElement("section");
    section.innerHTML = "<h2>" + game + "</h2><p class=brief>" + brief.genre + "; " + brief.mood + ". Follow-up: “" + brief.followUp + "”</p><div class=grid></div>";
    order.forEach((t, i) => {
      const card = document.createElement("div"); card.className = "card";
      const key = "score:" + game + "/" + t.id;
      const name = revealed ? LABEL[t.id[0]] + " · " + t.id.slice(2).replace("claude-", "") : "Track " + "PQRST"[i];
      card.innerHTML = "<div class=name>" + name + "</div>" +
        "<div class=row><button data-s=first>Play</button><button data-s=first data-seam=1>Seam</button><button data-s=edit>After</button><button data-s=edit data-seam=1>Seam</button></div>" +
        "<div class=row><label>Score <select><option value=''>–</option>" + [1,2,3,4,5].map((n) => "<option>" + n + "</option>").join("") + "</select></label>" +
        "<label>After <select data-edit=1><option value=''>–</option>" + [1,2,3,4,5].map((n) => "<option>" + n + "</option>").join("") + "</select></label></div>" +
        (revealed ? "<div class=meta>" + fmt(t.first) + "</div><div class=meta>after: " + fmt(t.edit) + "</div>" + (t.live ? "<div class=meta><a href='" + t.live + "' target=_blank>play in the game</a> · <a href='" + t.liveEdit + "' target=_blank>after</a></div>" : "") : "");
      card.querySelectorAll("button").forEach((b) => b.onclick = () => play(b.dataset.s === "edit" ? t.srcEdit : t.src, b, b.dataset.seam).catch((e) => { msg("missing " + e.message); stop(); }));
      card.querySelectorAll("select").forEach((s) => { const k = key + (s.dataset.edit ? ":edit" : ""); s.value = store.get(k) || ""; s.onchange = () => store.set(k, s.value); });
      section.querySelector(".grid").append(card);
    });
    root.append(section);
  }
};
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
const msg = (text) => { document.getElementById("msg").textContent = text; };
document.getElementById("stop").onclick = stop;
document.getElementById("reveal").onclick = (e) => { revealed = !revealed; e.target.textContent = revealed ? "Hide sources" : "Reveal sources"; render(); };
document.getElementById("copy").onclick = async () => {
  const lines = TRACKS.map((t) => t.game + " " + t.id + ": " + (store.get("score:" + t.game + "/" + t.id) || "-") + " (after: " + (store.get("score:" + t.game + "/" + t.id + ":edit") || "-") + ")");
  const text = lines.join("\\n");
  try { await navigator.clipboard.writeText(text); msg("Copied " + lines.length + " scores"); } catch { prompt("Copy these scores", text); }
};
render();
</script></body></html>`;

writeFileSync(path.join(OUT, "index.html"), html);
console.log(`${tracks.length} tracks → ${path.join(OUT, "index.html")}`);
