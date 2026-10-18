// PROTOTYPE (#129): renders a game's `hopon.music` ZzFXM song in headless Chromium, the way the scaffold does on the
// first tap, and writes it to a 16-bit stereo WAV for analysis. Returns the in-browser render time.
// node music/render-zzfxm.ts <game.js> <out.wav>
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { chromium } from "playwright-core";

import { buildRuntime, RUNTIME_PATH } from "../src/runtime.ts";

const RATE = 44_100;

export const wav = (left: Int16Array, right: Int16Array) => {
  const data = Buffer.alloc(left.length * 4);
  for (let i = 0; i < left.length; i += 1) {
    data.writeInt16LE(left[i], i * 4);
    data.writeInt16LE(right[i], i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
};

export const renderZzfxm = async (gameJs: string, outWav: string) => {
  await buildRuntime();
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(
    homedir(),
    "Library",
    "Caches",
    "ms-playwright"
  );
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.setContent(
      `<script>${readFileSync(RUNTIME_PATH, "utf-8")}</script><script>${gameJs.replaceAll("</script", String.raw`<\/script`)}</script>`
    );
    const result = await page.evaluate(() => {
      // oxlint-disable-next-line no-undef -- the runtime's globals
      const song = hopon.music;
      if (!song) {
        return;
      }
      const started = performance.now();
      // oxlint-disable-next-line no-undef
      const channels = zzfxM(...song);
      const ms = Math.round(performance.now() - started);
      const pcm = channels.map((channel) => {
        const out = new Int16Array(channel.length);
        let peak = 0;
        for (let i = 0; i < channel.length; i += 1) {
          const sample = channel[i] || 0;
          peak = Math.max(peak, Math.abs(sample));
          out[i] = Math.max(-1, Math.min(1, sample)) * 32_767;
        }
        let binary = "";
        const bytes = new Uint8Array(out.buffer);
        for (const byte of bytes) {
          binary += String.fromCodePoint(byte);
        }
        return { b64: btoa(binary), peak };
      });
      return { ms, pcm };
    });
    if (!result) {
      throw new Error(`no hopon.music${errors.length ? `: ${errors[0]}` : ""}`);
    }
    const [left, right] = result.pcm.map(
      ({ b64 }) =>
        new Int16Array(new Uint8Array(Buffer.from(b64, "base64")).buffer)
    );
    writeFileSync(outWav, wav(left, right));
    return {
      errors,
      peak: Math.max(...result.pcm.map(({ peak }) => peak)),
      renderMs: result.ms,
      seconds: Math.round((left.length / RATE) * 10) / 10,
    };
  } finally {
    await browser.close();
  }
};

if (import.meta.main) {
  const [gameJs, out] = process.argv.slice(2);
  console.log(await renderZzfxm(readFileSync(gameJs, "utf-8"), out));
}
