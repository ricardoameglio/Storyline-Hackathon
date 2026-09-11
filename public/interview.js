/* Prologue Interviewer — subject-facing voice room.
 *
 * Turn-taking: speak the question, then listen. Send the answer when they've
 * been quiet for SILENCE_MS, or when they press the button. The button always
 * works, because a demo where the only exit is a silence heuristic is a demo
 * that dies on stage.
 */

const SILENCE_MS = 2200;
const OPERATOR = new URLSearchParams(location.search).has("operator");
const interviewId = location.pathname.split("/").pop();

const $ = (id) => document.getElementById(id);
const el = {
  intro: $("intro"), live: $("live"), end: $("end"),
  greeting: $("greeting"), introHint: $("introHint"), start: $("start"),
  question: $("question"), heard: $("heard"), lvl: $("lvl"),
  next: $("next"), repeat: $("repeat"), finish: $("finish"),
  hint: $("hint"), err: $("err"), log: $("log"), logBox: $("logBox"),
  clock: $("clock"), dot: $("dot"), thanks: $("thanks"), endStats: $("endStats"),
};

let assignment = null;
let startedAt = null;
let recog = null;
let listening = false;
let silenceTimer = null;
let finalText = "";
let interimText = "";
let busy = false;
let audio = null;
let questionCount = 0;

if (OPERATOR) el.logBox.hidden = false;

/* ---------------------------------------------------------------- boot */

(async function boot() {
  try {
    const r = await fetch(`/api/interviews/${interviewId}`);
    if (!r.ok) throw new Error("This interview link isn't valid.");
    const data = await r.json();
    assignment = data.assignment;

    if (data.status === "finished") return showEnd();

    const first = (assignment?.subjectName || "there").split(" ")[0];
    el.greeting.textContent = `Hi ${first} — ready when you are.`;
    el.introHint.textContent = `About ${assignment?.durationMinutes ?? 10} minutes on ${assignment?.company ?? "your business"}. Find somewhere you can talk out loud.`;
    el.start.disabled = false;
  } catch (e) {
    el.greeting.textContent = "Couldn't load this interview.";
    el.introHint.textContent = e.message;
  }
})();

/* ------------------------------------------------------------- speech */

function supported() {
  return "webkitSpeechRecognition" in window || "SpeechRecognition" in window;
}

function buildRecognizer() {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new Ctor();
  r.continuous = true;
  r.interimResults = true;
  r.lang = "en-US";

  r.onresult = (ev) => {
    interimText = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const res = ev.results[i];
      if (res.isFinal) finalText += res[0].transcript + " ";
      else interimText += res[0].transcript;
    }
    paintHeard();
    bumpLevel();
    resetSilence();
  };

  r.onerror = (ev) => {
    if (ev.error === "no-speech" || ev.error === "aborted") return;
    if (ev.error === "not-allowed") {
      el.err.textContent = "Mic permission was blocked. Allow it in the address bar, then press “Done answering”.";
    } else {
      el.err.textContent = `Mic error: ${ev.error}. You can still use the buttons.`;
    }
  };

  // Chrome stops recognition on its own every so often; restart while we're listening.
  r.onend = () => { if (listening) { try { r.start(); } catch {} } };
  return r;
}

function startListening() {
  el.err.textContent = "";
  finalText = ""; interimText = "";
  paintHeard();
  if (!supported()) {
    el.hint.textContent = "This browser has no speech recognition — use Chrome, or type isn't available. Press “Done answering” to skip.";
    return;
  }
  listening = true;
  el.dot.classList.remove("idle");
  recog = recog || buildRecognizer();
  try { recog.start(); } catch {}
  resetSilence();
}

function stopListening() {
  listening = false;
  el.dot.classList.add("idle");
  clearTimeout(silenceTimer);
  if (recog) { try { recog.stop(); } catch {} }
  el.lvl.style.width = "0%";
}

function resetSilence() {
  clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => {
    if (listening && (finalText.trim() || interimText.trim())) submitAnswer();
  }, SILENCE_MS);
}

function paintHeard() {
  const t = (finalText + interimText).trim();
  el.heard.classList.toggle("active", Boolean(t));
  el.heard.innerHTML = t ? escapeHtml(t) : '<span class="ph">Listening…</span>';
}

let lvl = 0;
function bumpLevel() {
  lvl = Math.min(100, lvl + 22);
  el.lvl.style.width = lvl + "%";
  setTimeout(() => { lvl = Math.max(0, lvl - 18); el.lvl.style.width = lvl + "%"; }, 260);
}

/* ---------------------------------------------------------------- tts */

async function say(text) {
  stopListening();
  el.question.textContent = text;
  try {
    const r = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (r.status === 204) return browserVoice(text);
    const buf = await r.arrayBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
    if (audio) audio.pause();
    audio = new Audio(url);
    await new Promise((resolve) => {
      audio.onended = resolve;
      audio.onerror = resolve;
      audio.play().catch(resolve);
    });
  } catch {
    return browserVoice(text);
  }
}

function browserVoice(text) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02; u.pitch = 1;
    u.onend = resolve; u.onerror = resolve;
    speechSynthesis.speak(u);
  });
}

/* --------------------------------------------------------------- flow */

el.start.onclick = async () => {
  el.start.disabled = true;
  el.intro.hidden = true;
  el.live.hidden = false;
  startedAt = Date.now();
  tickClock();

  try {
    const r = await fetch(`/api/interviews/${interviewId}/start`, { method: "POST" });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Could not start.");
    await say(data.greeting);
    logTurn("q", data.question.question, data.question.reasoning, data.question.move);
    questionCount++;
    await say(data.question.question);
    startListening();
  } catch (e) {
    el.err.textContent = e.message;
  }
};

el.next.onclick = () => submitAnswer();
el.repeat.onclick = () => say(el.question.textContent).then(startListening);
el.finish.onclick = async () => {
  stopListening();
  await fetch(`/api/interviews/${interviewId}/end`, { method: "POST" });
  showEnd();
};

async function submitAnswer() {
  if (busy) return;
  const text = (finalText + " " + interimText).trim();
  stopListening();
  if (!text) { startListening(); return; }

  busy = true;
  el.next.disabled = true;
  el.hint.textContent = "Thinking…";
  logTurn("a", text);

  try {
    const r = await fetch(`/api/interviews/${interviewId}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Something broke.");

    const q = data.question;
    logTurn("q", q.question, q.reasoning, q.move);
    questionCount++;
    el.heard.innerHTML = '<span class="ph">Listening…</span>';
    el.hint.textContent = "Just talk. It'll wait for you to finish.";
    busy = false;
    el.next.disabled = false;

    await say(q.question);
    if (data.interview.status === "finished") return showEnd();
    startListening();
  } catch (e) {
    busy = false;
    el.next.disabled = false;
    el.err.textContent = e.message;
    el.hint.textContent = "Press “Done answering” to try again.";
  }
}

function showEnd() {
  stopListening();
  el.intro.hidden = true;
  el.live.hidden = true;
  el.end.hidden = false;
  const first = (assignment?.subjectName || "").split(" ")[0];
  el.thanks.textContent = first ? `Thank you, ${first}.` : "Thank you.";
  const mins = startedAt ? Math.round((Date.now() - startedAt) / 60000) : null;
  el.endStats.textContent = mins != null
    ? `${questionCount} questions over ${mins} minute${mins === 1 ? "" : "s"}.`
    : "";
}

/* -------------------------------------------------------------- chrome */

function tickClock() {
  setInterval(() => {
    if (!startedAt) return;
    const s = Math.floor((Date.now() - startedAt) / 1000);
    el.clock.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }, 1000);
}

function logTurn(kind, text, why, move) {
  if (!OPERATOR) return;
  const d = document.createElement("div");
  d.className = `t ${kind}`;
  d.innerHTML =
    `<b>${kind === "q" ? (move || "question") : (assignment?.subjectName || "them")}</b>` +
    escapeHtml(text) +
    (why ? `<div class="why">${escapeHtml(why)}</div>` : "");
  el.log.appendChild(d);
  d.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
