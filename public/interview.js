/* Prologue Interviewer — subject-facing room.
 *
 * Two ways to answer: talk or type. Voice turn-taking is speak → listen →
 * send on silence, with a button that always works, because a demo whose only
 * exit is a silence heuristic is a demo that dies on stage.
 */

const SILENCE_MS = 2200;
const OPERATOR = new URLSearchParams(location.search).has("operator");
const interviewId = location.pathname.split("/").pop();

const $ = (id) => document.getElementById(id);
const el = {
  intro: $("intro"), live: $("live"), end: $("end"),
  greeting: $("greeting"), introHint: $("introHint"), start: $("start"),
  modeVoice: $("modeVoice"), modeText: $("modeText"), modeHint: $("modeHint"),
  question: $("question"), heard: $("heard"), lvl: $("lvl"),
  typed: $("typed"), typedText: $("typedText"), swap: $("swap"),
  next: $("next"), repeat: $("repeat"), finish: $("finish"),
  hint: $("hint"), err: $("err"), log: $("log"), logBox: $("logBox"),
  clock: $("clock"), dot: $("dot"), thanks: $("thanks"), endStats: $("endStats"),
  pdf: $("pdf"), endBar: $("endBar"), writing: $("writing"), copy: $("copy"),
};

/* UI copy. Neutral Latin American Spanish — "tú", no "vos", no "vosotros". */
const STRINGS = {
  en: {
    ready: (n) => (n ? `Hi ${n} — ready when you are.` : "Ready when you are."),
    introIntake: (m) =>
      `I'll ask you a couple of quick things first, then we'll get into it. About ${m} minutes in all.`,
    introKnown: (m, about) => `About ${m} minutes on ${about}.`,
    aboutFallback: "what you do",
    start: "Start the interview",
    talk: "Talk to it", type: "Type instead", talkInstead: "Talk instead",
    send: "Send", done: "Done answering", again: "Say it again", endEarly: "End early",
    listening: "Listening…", typeHere: "Type your answer…",
    hintVoice: "Just talk. It'll wait for you to finish.",
    hintText: "Type your answer, then press Send.",
    micHint: "Works best in Chrome. Your mic stays on only while you're answering.",
    textHint: "You'll type your answers. Nothing is recorded.",
    thinking: "Thinking…",
    thanks: (n) => (n ? `Thank you, ${n}.` : "Thank you."),
    stats: (q, m) => `${q} questions over ${m} minute${m === 1 ? "" : "s"}.`,
    writing: "Writing your post now — about twenty seconds.",
    hereItIs: "Here it is. Yours to keep.",
    stillWriting: "Still writing — this is taking longer than usual.",
    nothing: "Nothing was recorded, so there's nothing to write up.",
    failed: "Something went wrong writing this up.",
    retry: "Try again",
    pdf: "Download as PDF",
    hSummary: "What we talked about", hLine: "The line", hStood: "What stood out",
    copy: "Copy", copied: "Copied",
    checked: (n) =>
      n
        ? `Fact-checked against your own words — ${n} line${n === 1 ? "" : "s"} corrected or cut before you saw this.`
        : "Fact-checked against your own words. Nothing needed changing.",
    micBlocked: "Mic permission was blocked. Allow it in the address bar, or switch to typing.",
    noSpeech: "This browser can't hear you — switch to typing.",
    tryAgain: "Press the button to try again.",
    badLink: "This interview link isn't valid.",
    cantLoad: "Couldn't load this interview.",
  },
  es: {
    ready: (n) => (n ? `Hola ${n} — cuando quieras.` : "Cuando quieras."),
    introIntake: (m) =>
      `Primero te pregunto un par de cosas rápidas y después entramos en materia. Unos ${m} minutos en total.`,
    introKnown: (m, about) => `Unos ${m} minutos sobre ${about}.`,
    aboutFallback: "lo que haces",
    start: "Empezar la entrevista",
    talk: "Hablar", type: "Escribir", talkInstead: "Mejor hablar",
    send: "Enviar", done: "Ya terminé", again: "Repítelo", endEarly: "Terminar ya",
    listening: "Escuchando…", typeHere: "Escribe tu respuesta…",
    hintVoice: "Habla normal. Espera a que termines.",
    hintText: "Escribe tu respuesta y dale Enviar.",
    micHint: "Funciona mejor en Chrome. El micrófono solo se activa mientras respondes.",
    textHint: "Vas a escribir tus respuestas. No se graba nada.",
    thinking: "Pensando…",
    thanks: (n) => (n ? `Gracias, ${n}.` : "Gracias."),
    stats: (q, m) => `${q} preguntas en ${m} minuto${m === 1 ? "" : "s"}.`,
    writing: "Estoy escribiendo tu publicación — unos veinte segundos.",
    hereItIs: "Aquí está. Es tuya.",
    stillWriting: "Todavía escribiendo — está tardando más de lo normal.",
    nothing: "No quedó nada grabado, así que no hay nada que redactar.",
    failed: "Algo salió mal al redactar esto.",
    retry: "Intentar de nuevo",
    pdf: "Descargar en PDF",
    hSummary: "De qué hablamos", hLine: "La frase", hStood: "Lo que más resaltó",
    copy: "Copiar", copied: "Copiado",
    checked: (n) =>
      n
        ? `Verificado contra tus propias palabras — ${n} línea${n === 1 ? "" : "s"} corregida${n === 1 ? "" : "s"} o eliminada${n === 1 ? "" : "s"} antes de que la vieras.`
        : "Verificado contra tus propias palabras. No hubo nada que corregir.",
    micBlocked: "Se bloqueó el micrófono. Permítelo en la barra de direcciones, o cambia a escribir.",
    noSpeech: "Este navegador no puede escucharte — cambia a escribir.",
    tryAgain: "Dale al botón para intentar otra vez.",
    badLink: "Este enlace de entrevista no sirve.",
    cantLoad: "No se pudo cargar la entrevista.",
  },
};

let language = "en";
let T = STRINGS.en;
let assignment = null;
let mode = "voice";
let phase = "interview";
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
    if (!r.ok) throw new Error(T.badLink);
    const data = await r.json();
    assignment = data.assignment;
    language = assignment?.language === "es" ? "es" : "en";
    T = STRINGS[language];
    document.documentElement.lang = language;
    applyStaticStrings();
    phase = data.phase || "interview";
    setMode(data.mode === "text" ? "text" : "voice", false);

    if (data.status === "finished") return showEnd();

    const mins = assignment?.durationMinutes ?? 10;
    if (phase === "intake") {
      el.greeting.textContent = T.ready("");
      el.introHint.textContent = T.introIntake(mins);
    } else {
      const first = (assignment?.subjectName || "").split(" ")[0];
      const about = assignment?.company?.trim() || T.aboutFallback;
      el.greeting.textContent = T.ready(first);
      el.introHint.textContent = T.introKnown(mins, about);
    }
    el.start.disabled = false;
  } catch (e) {
    el.greeting.textContent = T.cantLoad;
    el.introHint.textContent = e.message;
  }
})();

function applyStaticStrings() {
  if (el.start) el.start.textContent = T.start;
  if (el.modeVoice) el.modeVoice.textContent = T.talk;
  if (el.modeText) el.modeText.textContent = T.type;
  if (el.repeat) el.repeat.textContent = T.again;
  if (el.finish) el.finish.textContent = T.endEarly;
  if (el.pdf) el.pdf.textContent = T.pdf;
  if (el.writing) el.writing.textContent = T.writing;
  if (el.typedText) el.typedText.placeholder = T.typeHere;
  if (el.heard) el.heard.innerHTML = `<span class="ph">${T.listening}</span>`;
}

/* ---------------------------------------------------------------- mode */

function setMode(next, tellServer = true) {
  mode = next === "text" ? "text" : "voice";
  const isText = mode === "text";

  el.modeVoice?.classList.toggle("on", !isText);
  el.modeText?.classList.toggle("on", isText);
  if (el.typed) el.typed.hidden = !isText;
  if (el.heard) el.heard.hidden = isText;
  if (el.repeat) el.repeat.hidden = isText;
  if (el.swap) el.swap.textContent = isText ? T.talkInstead : T.type;
  if (el.next) el.next.textContent = isText ? T.send : T.done;
  if (el.modeHint) {
    el.modeHint.textContent = isText ? T.textHint : T.micHint;
  }
  if (el.hint) {
    el.hint.textContent = isText ? T.hintText : T.hintVoice;
  }

  if (isText) stopListening();
  if (tellServer) {
    fetch(`/api/interviews/${interviewId}/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    }).catch(() => {});
  }
}

el.modeVoice && (el.modeVoice.onclick = () => setMode("voice"));
el.modeText && (el.modeText.onclick = () => setMode("text"));
el.swap && (el.swap.onclick = () => {
  const next = mode === "text" ? "voice" : "text";
  setMode(next);
  if (next === "voice") startListening();
  else el.typedText?.focus();
});

/* ------------------------------------------------------------- speech */

function supported() {
  return "webkitSpeechRecognition" in window || "SpeechRecognition" in window;
}

function buildRecognizer() {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new Ctor();
  r.continuous = true;
  r.interimResults = true;
  r.lang = language === "es" ? "es-US" : "en-US";

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
      el.err.textContent =
        T.micBlocked;
    } else {
      el.err.textContent = `${ev.error} — ${T.noSpeech}`;
    }
  };

  r.onend = () => { if (listening) { try { r.start(); } catch {} } };
  return r;
}

function startListening() {
  if (mode === "text") return;
  el.err.textContent = "";
  finalText = ""; interimText = "";
  paintHeard();
  if (!supported()) {
    el.hint.textContent = T.noSpeech;
    setMode("text");
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
  el.dot?.classList.add("idle");
  clearTimeout(silenceTimer);
  if (recog) { try { recog.stop(); } catch {} }
  if (el.lvl) el.lvl.style.width = "0%";
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
  el.heard.innerHTML = t ? escapeHtml(t) : `<span class="ph">${T.listening}</span>`;
  el.heard.scrollTop = el.heard.scrollHeight;
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
      body: JSON.stringify({ text, language }),
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
    u.lang = language === "es" ? "es-US" : "en-US";
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
    if (data.assignment) assignment = data.assignment;
    phase = data.interview?.phase || phase;

    await say(data.greeting);
    logTurn("q", data.question.question, data.question.reasoning, data.question.move);
    questionCount++;
    await say(data.question.question);
    afterQuestion();
  } catch (e) {
    el.err.textContent = e.message;
  }
};

el.next.onclick = () => submitAnswer();
el.repeat.onclick = () => say(el.question.textContent).then(() => afterQuestion());
el.finish.onclick = async () => {
  stopListening();
  await fetch(`/api/interviews/${interviewId}/end`, { method: "POST" });
  showEnd();
};

el.typedText && el.typedText.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitAnswer();
});

/** After the interviewer finishes speaking: listen, or hand them the keyboard. */
function afterQuestion() {
  if (mode === "text") el.typedText?.focus();
  else startListening();
}

async function submitAnswer() {
  if (busy) return;

  let text;
  if (mode === "text") {
    text = (el.typedText?.value ?? "").trim();
    if (!text) { el.typedText?.focus(); return; }
  } else {
    text = (finalText + " " + interimText).trim();
    stopListening();
    if (!text) { startListening(); return; }
  }

  busy = true;
  el.next.disabled = true;
  el.hint.textContent = T.thinking;
  logTurn("a", text);
  if (mode === "text" && el.typedText) el.typedText.value = "";

  try {
    const r = await fetch(`/api/interviews/${interviewId}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Something broke.");
    if (data.assignment) assignment = data.assignment;
    phase = data.interview?.phase || phase;

    const q = data.question;
    logTurn("q", q.question, q.reasoning, q.move);
    questionCount++;
    el.heard.innerHTML = `<span class="ph">${T.listening}</span>`;
    el.hint.textContent = mode === "text" ? T.hintText : T.hintVoice;
    busy = false;
    el.next.disabled = false;

    // Handoff out of intake: one line, then straight into the first real question.
    if (data.sayFirst) await say(data.sayFirst);
    await say(q.question);

    if (data.interview.status === "finished") return showEnd();
    afterQuestion();
  } catch (e) {
    busy = false;
    el.next.disabled = false;
    el.err.textContent = e.message;
    el.hint.textContent = T.tryAgain;
  }
}

function showEnd() {
  stopListening();
  el.intro.hidden = true;
  el.live.hidden = true;
  el.end.hidden = false;
  const first = (assignment?.subjectName || "").split(" ")[0];
  el.thanks.textContent = T.thanks(first);
  const mins = startedAt ? Math.round((Date.now() - startedAt) / 60000) : null;
  el.endStats.textContent = mins != null ? T.stats(questionCount, mins) : "";
  waitForCopy();
}

el.pdf && (el.pdf.onclick = () => window.print());

/* The payoff. The subject is still standing there — show them their post. */
let copyTries = 0;
async function waitForCopy() {
  if (!el.copy) return;
  try {
    const r = await fetch(`/api/interviews/${interviewId}`);
    const data = await r.json();
    if (data.assignment) assignment = data.assignment;
    const c = data.content;

    if (c && c.error) return failed(c.error);
    if (c && (c.summary || c.instagramCaption || c.nail)) {
      if (el.writing) el.writing.textContent = T.hereItIs;
      if (el.endBar) el.endBar.hidden = false;
      renderCopy(el.copy, c);
      return;
    }

    // Nothing will ever arrive if nobody actually answered anything.
    const answered = (data.turns || []).some(
      (t) => t.speaker === "subject" && (t.phase || "interview") === "interview",
    );
    if (!answered && data.status === "finished") {
      if (el.writing) el.writing.textContent = T.nothing;
      return;
    }
  } catch {}

  if (++copyTries > 40) return failed();
  setTimeout(waitForCopy, 3000);
}

/** Say so, and offer the retry. Silence is the worst possible answer here. */
function failed(detail) {
  if (el.writing) el.writing.textContent = detail ? `${T.failed} (${detail})` : T.stillWriting;
  if (!el.copy || el.copy.querySelector("[data-retry]")) return;
  const b = document.createElement("button");
  b.className = "copybtn";
  b.setAttribute("data-retry", "1");
  b.textContent = T.retry;
  b.onclick = async () => {
    b.disabled = true;
    if (el.writing) el.writing.textContent = T.writing;
    try {
      const r = await fetch(`/api/interviews/${interviewId}/content?force=1`, { method: "POST" });
      const c = await r.json();
      if (!r.ok || c.error) throw new Error(c.error || "failed");
      if (el.endBar) el.endBar.hidden = false;
      renderCopy(el.copy, c);
    } catch (e) {
      b.disabled = false;
      if (el.writing) el.writing.textContent = `${T.failed} (${e.message})`;
    }
  };
  el.copy.appendChild(b);
}

function renderCopy(box, c) {
  const blocks = [];
  if (c.summary)
    blocks.push(`<div class="out"><h3>${T.hSummary}</h3><p>${escapeHtml(c.summary)}</p></div>`);
  if (c.nail)
    blocks.push(`<div class="out"><h3>${T.hLine}</h3><p class="nail">${escapeHtml(c.nail)}</p></div>`);
  if (c.instagramCaption) blocks.push(sect("Instagram", c.instagramCaption));
  if (c.linkedinPost) blocks.push(sect("LinkedIn", c.linkedinPost));
  if (c.pullQuotes?.length) {
    blocks.push(
      `<div class="out"><h3>${T.hStood}</h3>` +
        c.pullQuotes.slice(0, 3).map((q) => `<p>\u201C${escapeHtml(q.quote)}\u201D</p>`).join("") +
        `</div>`,
    );
  }
  if (c.corrections) {
    blocks.push(`<p class="checked">${T.checked(c.corrections.length)}</p>`);
  }
  box.innerHTML = blocks.join("");

  box.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigator.clipboard?.writeText(btn.getAttribute("data-copy") || "");
      btn.textContent = T.copied;
      setTimeout(() => (btn.textContent = T.copy), 1600);
    });
  });
}

function sect(title, text) {
  return `<div class="out"><h3>${title}</h3><p>${escapeHtml(
    text,
  )}</p><button class="copybtn" data-copy="${escapeHtml(text)}">${T.copy}</button></div>`;
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
  el.logBox.scrollTop = el.logBox.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
