/* A small live spectrum: the interviewer's voice, and yours.
 *
 * Real audio, not a loop of CSS. When the interviewer speaks it reads the
 * playing audio element; when you speak it reads the microphone. It matters
 * because a bar that moves with an actual voice tells you the thing is
 * listening — and on a stage, silence with a still screen looks broken.
 *
 * Every path fails soft. If the Web Audio API refuses anywhere, the bars fall
 * back to a gentle idle motion and the audio still plays. Nothing here is ever
 * allowed to break the interview.
 */
(function () {
  const BARS = 44;
  const GAP = 2; // a hair of daylight between bars — enough to read as separate
  const canvas = document.getElementById("viz");
  if (!canvas) return;

  const ctx2d = canvas.getContext("2d");
  let audioCtx = null;
  let analyser = null;
  let data = null;
  let micStream = null;
  let micNode = null;
  let mode = "idle"; // idle | ai | you
  let live = false; // true only once a real source is feeding the analyser
  let levels = new Array(BARS).fill(0);
  let raf = null;
  const elementSources = new WeakMap();

  const css = (name, fallback) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

  function ensureCtx() {
    if (audioCtx) return audioCtx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.75;
    data = new Uint8Array(analyser.frequencyBinCount);
    return audioCtx;
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 200;
    const h = canvas.clientHeight || 34;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);

  function sample() {
    if (analyser && live && mode !== "idle") {
      analyser.getByteFrequencyData(data);
      const step = Math.max(1, Math.floor(data.length / BARS));
      for (let i = 0; i < BARS; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += data[i * step + j] || 0;
        const v = Math.min(1, sum / step / 190);
        levels[i] += (v - levels[i]) * 0.45;
      }
      return;
    }
    // Idle, or audio analysis unavailable: a slow breath so it never looks dead.
    const t = Date.now() / 620;
    for (let i = 0; i < BARS; i++) {
      const target = mode === "idle" ? 0.06 : 0.18 + 0.14 * Math.sin(t + i * 0.55);
      levels[i] += (target - levels[i]) * 0.12;
    }
  }

  function draw() {
    sample();
    const w = canvas.clientWidth || 200;
    const h = canvas.clientHeight || 34;
    ctx2d.clearRect(0, 0, w, h);

    const barW = Math.max(1, (w - GAP * (BARS - 1)) / BARS);
    const mid = h / 2;
    ctx2d.fillStyle =
      mode === "ai" ? css("--accent", "#B4410E") : mode === "you" ? css("--ink", "#17150F") : css("--line", "#DDD6C7");

    for (let i = 0; i < BARS; i++) {
      const level = Math.max(0.04, levels[i]);
      const barH = Math.max(2, level * (h - 4));
      const x = i * (barW + GAP);
      const r = Math.min(barW / 2, 2);
      const y = mid - barH / 2;
      ctx2d.beginPath();
      if (ctx2d.roundRect) ctx2d.roundRect(x, y, barW, barH, r);
      else ctx2d.rect(x, y, barW, barH);
      ctx2d.fill();
    }
    raf = requestAnimationFrame(draw);
  }
  if (!raf) raf = requestAnimationFrame(draw);

  /** Route a playing <audio> through the analyser, without risking playback. */
  function watchElement(el) {
    try {
      const ac = ensureCtx();
      if (!ac || !el) { mode = "ai"; live = false; return; }
      if (ac.state === "suspended") ac.resume();
      let src = elementSources.get(el);
      if (!src) {
        src = ac.createMediaElementSource(el);
        elementSources.set(el, src);
        // Destination first: if anything after this throws, sound still comes out.
        src.connect(ac.destination);
        src.connect(analyser);
      }
      mode = "ai";
      live = true;
    } catch {
      mode = "ai"; // keep the breathing motion rather than nothing
      live = false;
    }
  }

  async function watchMic() {
    try {
      mode = "you";
      const ac = ensureCtx();
      if (!ac) { live = false; return; }
      if (ac.state === "suspended") await ac.resume();
      if (!micStream) {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micNode = ac.createMediaStreamSource(micStream);
      }
      micNode.connect(analyser);
      live = true;
    } catch {
      mode = "you";
      live = false;
    }
  }

  function stopMic() {
    try { micNode?.disconnect(); } catch {}
    live = false;
  }

  window.Waveform = {
    ai(el) { stopMic(); watchElement(el); },
    you() { watchMic(); },
    idle() { stopMic(); mode = "idle"; },
    /** Called when the room is done, so the mic light goes out. */
    release() {
      stopMic();
      try { micStream?.getTracks().forEach((t) => t.stop()); } catch {}
      micStream = null; micNode = null; mode = "idle";
    },
  };
})();
