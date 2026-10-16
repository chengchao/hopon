/* oxlint-disable curly, promise/prefer-await-to-then, no-empty-function, unicorn/consistent-function-scoping, unicorn/require-post-message-target-origin, promise/prefer-await-to-callbacks, no-implicit-globals, no-inline-comments -- ReactNativeWebView.postMessage takes no origin; soundVolume is the engine global; a browser classic script, kept terse */
// PROTOTYPE scaffold, appended to LittleJS in /runtime/v1.js. Runs as a classic script, so it sees the engine's
// globals (audioContext, soundVolume, setPaused). Owns the feed bridge: {type:'pause'|'resume'|'mute', on}.
(() => {
  const VOLUME = soundVolume;
  const rn = window.ReactNativeWebView;
  // In the feed a card starts paused until the app says it's the active one, so a neighbour preloading
  // off-screen never makes a sound. Outside the app (a desktop browser) there's no bridge, so it starts live.
  let paused = !!rn;
  let muted = false;
  let tapped = false;
  const music = () => document.querySelector("audio[data-hopon-music]");
  const state = () => {
    const m = music();
    return {
      ctx: audioContext?.state,
      gain: audioMasterGain?.gain.value,
      music: m && {
        error: m.error?.code,
        paused: m.paused,
        ready: m.readyState,
        t: Math.round(m.currentTime * 10) / 10,
      },
      muted,
      paused,
      tapped,
    };
  };
  const report = (event, extra) =>
    rn?.postMessage(JSON.stringify({ event, ...extra, ...state() }));
  window.hoponReport = report;

  const apply = () => {
    const silent = paused || muted;
    soundVolume = silent ? 0 : VOLUME; // the engine copies it to the master gain each frame
    if (audioMasterGain) audioMasterGain.gain.value = soundVolume;
    setPaused(paused);
    if (paused) audioContext?.suspend();
    else audioResume();
    const m = music();
    if (!m) return;
    m.muted = muted;
    if (paused) m.pause();
    else
      m.play()
        .then(() => report("music-play-ok"))
        .catch((error) => report("music-play-rejected", { error: error.name }));
  };

  const onMessage = (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.type === "pause") paused = true;
    else if (msg.type === "resume") paused = false;
    else if (msg.type === "mute") muted = !!msg.on;
    else return;
    apply();
    report(`got-${msg.type}`);
  };
  // iOS delivers the app's postMessage on window, Android on document.
  window.addEventListener("message", onMessage);
  document.addEventListener("message", onMessage);

  addEventListener(
    "pointerdown",
    () => {
      tapped = true;
      apply();
      report("first-tap");
    },
    { capture: true, once: true }
  );
  // The engine suspends its AudioContext when the page is hidden (another screen over the feed, the app in the
  // background), but an <audio> element plays on, so the music follows visibility too.
  document.addEventListener("visibilitychange", () => {
    const m = music();
    if (document.hidden) m?.pause();
    else if (!paused) m?.play().catch(() => {});
    report(document.hidden ? "hidden" : "visible");
  });
  apply(); // silent from the first frame; the music element doesn't exist yet, `load` catches it
  addEventListener("load", () => {
    apply();
    report("load");
  });
  setInterval(() => report("tick"), 2000);
})();
