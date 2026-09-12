/* Prologue Interviewer — subject-facing room.
 *
 * Two ways to answer: talk or type. Voice turn-taking is speak → listen →
 * send on silence, with a button that always works, because a demo whose only
 * exit is a silence heuristic is a demo that dies on stage.
 */

const SILENCE_MS = 2200;

/* How people actually speak, turned into readable text.
 *
 * The browser returns a naked stream of words with no punctuation, so a long
 * answer arrives as one unbreathable sentence and every quote pulled from it
 * reads like one too. Chrome finalises a segment whenever the speaker pauses,
 * so the gap between finalised segments is a fair proxy for the pause itself:
 * a beat is a comma, a breath is a full stop. */
const COMMA_PAUSE_MS = 420;
const PERIOD_PAUSE_MS = 950;
let lastFinalAt = 0;

/** Glue a newly finalised chunk on, punctuating by how long they paused. */
function appendSpoken(existing, chunk) {
  const now = Date.now();
  const gap = lastFinalAt ? now - lastFinalAt : 0;
  lastFinalAt = now;

  const piece = String(chunk).trim();
  if (!piece) return existing;

  const out = String(existing).trimEnd();
  if (!out) return capitalise(piece);
  if (/[.,!?;:]$/.test(out)) {
    return out + " " + (/[.!?]$/.test(out) ? capitalise(piece) : piece);
  }
  if (gap >= PERIOD_PAUSE_MS) return out + ". " + capitalise(piece);
  if (gap >= COMMA_PAUSE_MS) return out + ", " + piece;
  return out + " " + piece;
}

const capitalise = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/** A spoken answer ends somewhere — close the last sentence before sending it. */
function finishSentence(t) {
  const clean = String(t).trim().replace(/\s+([,.])/g, "$1");
  return !clean || /[.!?]$/.test(clean) ? clean : clean + ".";
}
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
  alert: $("alert"), alertTitle: $("alertTitle"), alertBody: $("alertBody"),
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
    talk: "Voice", type: "Type instead", talkInstead: "Use voice",
    send: "Send", done: "Done answering", again: "Say it again", endEarly: "End early",
    listening: "Listening…", typeHere: "Type your answer…",
    hintVoice: "Answers send after a pause. You can also finish manually.",
    hintText: "Type your answer, then press Send.",
    micHint: "Works best in Chrome. Your mic stays on only while you're answering.",
    textHint: "Answer by typing. Your microphone stays off.",
    thinking: "Thinking…",
    thanks: (n) => (n ? `Thank you, ${n}.` : "Thank you."),
    stats: (q, m) => `${q} questions over ${m} minute${m === 1 ? "" : "s"}.`,
    writing: "Preparing your story…",
    hereItIs: "Your story is ready.",
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
    alertTitle: "Alert · content not allowed",
    alertBody:
      "This interview has been ended. Explicit, sexual, hateful or threatening language isn't allowed here — these conversations are kept as records with real people's names on them. Nothing from this session was saved or published.",
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
    textHint: "Responde por escrito. El micrófono permanece apagado.",
    thinking: "Pensando…",
    thanks: (n) => (n ? `Gracias, ${n}.` : "Gracias."),
    stats: (q, m) => `${q} preguntas en ${m} minuto${m === 1 ? "" : "s"}.`,
    writing: "Preparando tu historia…",
    hereItIs: "Tu historia está lista.",
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
    alertTitle: "Alerta · contenido no permitido",
    alertBody:
      "Esta entrevista se cerró. Aquí no se permite lenguaje explícito, sexual, de odio ni amenazas — estas conversaciones quedan como registros con el nombre real de una persona. No se guardó ni se publicó nada de esta sesión.",
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
let completedInterview = null;
let resultText = "";

function presentState(state) {
  el.live.dataset.state = state;
  const labels = language === "es"
    ? { ready: "Listo para responder", listening: "Escuchando", speaking: "Entrevistador hablando", thinking: "Pensando", starting: "Conectando", error: "Necesita atención", complete: "Entrevista completa" }
    : { ready: "Ready for your answer", listening: "Listening", speaking: "Interviewer speaking", thinking: "Thinking", starting: "Connecting", error: "Needs attention", complete: "Interview complete" };
  if ($("sessionState")) $("sessionState").textContent = labels[state] || labels.ready;
  if ($("questionProgress")) $("questionProgress").textContent = phase === "intake"
    ? (language === "es" ? "Presentación" : "Getting acquainted")
    : (questionCount ? (language === "es" ? `Pregunta ${questionCount}` : `Question ${questionCount}`) : "");
  const waiting = ["starting", "thinking", "speaking"].includes(state);
  el.next.disabled = el.repeat.disabled = el.swap.disabled = el.finish.disabled = waiting;
}

function processing(active) {
  if ($("processingTrack")) $("processingTrack").hidden = !active;
  el.copy?.setAttribute("aria-busy", String(active));
}

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

    if (data.status === "finished") return showEnd(data);

    const mins = assignment?.durationMinutes ?? 10;
    if (phase === "intake") {
      el.greeting.textContent = T.ready("");
      el.introHint.textContent = T.introIntake(mins);
    } else {
      const first = (assignment?.subjectName || "").split(" ")[0];
      const about = assignment?.interviewType === "personal"
        ? (language === "es" ? "tu historia" : "your story")
        : assignment?.company?.trim() || T.aboutFallback;
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
  $("answerLabel").textContent = language === "es" ? "Tu respuesta" : "Your answer";
  $("transcriptLabel").textContent = language === "es" ? "Transcripción" : "Transcript";
  el.typedText?.setAttribute("aria-label", language === "es" ? "Tu respuesta" : "Your answer");
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
  el.modeVoice?.setAttribute("aria-pressed", String(!isText));
  el.modeText?.setAttribute("aria-pressed", String(isText));
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
  if (!el.live.hidden && !busy) presentState(isText ? "ready" : "listening");
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
      if (res.isFinal) finalText = appendSpoken(finalText, res[0].transcript);
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
    presentState("error");
  };

  r.onend = () => { if (listening) { try { r.start(); } catch {} } };
  return r;
}

function startListening() {
  if (mode === "text") return;
  el.err.textContent = "";
  finalText = ""; interimText = "";
  lastFinalAt = 0;
  paintHeard();
  if (!supported()) {
    el.hint.textContent = T.noSpeech;
    setMode("text");
    return;
  }
  listening = true;
  presentState("listening");
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
  presentState("speaking");
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
  presentState("starting");
  startedAt = Date.now();
  tickClock();

  try {
    const r = await fetch(`/api/interviews/${interviewId}/start`, { method: "POST" });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Could not start.");
    startedAt = data.interview?.startedAt ?? startedAt;
    if (data.assignment) assignment = data.assignment;
    phase = data.interview?.phase || phase;

    await say(data.greeting);
    logTurn("q", data.question.question, data.question.reasoning, data.question.move);
    questionCount++;
    await say(data.question.question);
    afterQuestion();
  } catch (e) {
    el.err.textContent = e.message;
    presentState("error");
    el.question.textContent = language === "es" ? "No se pudo iniciar la entrevista." : "The interview could not start.";
  }
};

el.next.onclick = () => submitAnswer();
el.repeat.onclick = () => say(el.question.textContent).then(() => afterQuestion());
el.finish.onclick = async () => {
  if (busy) return;
  busy = true;
  el.finish.disabled = true;
  stopListening();
  try {
    const text = mode === "text" ? (el.typedText?.value || "").trim() : (finalText + " " + interimText).trim();
    const r = await fetch(`/api/interviews/${interviewId}/end`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || T.failed);
    showEnd(data);
  } catch (e) {
    el.err.textContent = e.message;
    presentState("error");
  } finally { busy = false; el.finish.disabled = false; }
};

el.typedText && el.typedText.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitAnswer();
});

/** After the interviewer finishes speaking: listen, or hand them the keyboard. */
function afterQuestion() {
  presentState(mode === "text" ? "ready" : "listening");
  if (mode === "text") el.typedText?.focus();
  else startListening();
}

async function submitAnswer() {
  if (awaitingConsent) {
    const spoken = finishSentence(
      interimText.trim() ? appendSpoken(finalText, interimText) : finalText,
    );
    stopListening();
    if (!spoken.trim()) { startListening(); return; }
    return submitSpokenConsent(spoken);
  }
  if (busy) return;

  let text;
  if (mode === "text") {
    text = (el.typedText?.value ?? "").trim();
    if (!text) { el.typedText?.focus(); return; }
  } else {
    text = finishSentence(
      interimText.trim() ? appendSpoken(finalText, interimText) : finalText,
    );
    stopListening();
    if (!text) { startListening(); return; }
  }

  busy = true;
  presentState("thinking");
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

    // The screener ended it. Put the warning up FIRST, so it is on screen while
    // the interviewer says its line — they should see why, not just that.
    if (data.ended || !data.question) {
      busy = false;
      el.next.disabled = false;
      if (data.ended) showAlert();
      if (data.say) await say(data.say);
      return showEnd(data.interview);
    }

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

    if (data.interview.status === "finished") return showEnd(data.interview);
    afterQuestion();
  } catch (e) {
    busy = false;
    el.next.disabled = false;
    el.err.textContent = e.message;
    el.hint.textContent = T.tryAgain;
    presentState("error");
  }
}

/** Amber banner, warning glyph, both languages. Stays up through the end screen. */
function showAlert() {
  if (!el.alert) return;
  el.alertTitle.textContent = T.alertTitle;
  el.alertBody.textContent = T.alertBody;
  el.alert.hidden = false;
  el.alert.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showEnd(data = completedInterview) {
  completedInterview = data;
  stopListening();
  if (audio) audio.pause();
  window.speechSynthesis?.cancel();
  presentState("complete");
  el.intro.hidden = true;
  el.live.hidden = true;
  if (!data?.consentAt) {
    el.end.hidden = true;
    $("consent").hidden = false;
    if (language === "es") {
      $("consentEyebrow").textContent = "Una última cosa";
      $("consentTitle").textContent = "Antes de terminar, ¿prefieres que esta conversación sea privada o que aparezca en el archivo público?";
      $("choosePrivate").innerHTML = "<strong>Privada</strong><span>No aparecerá en The Wall. Quienes tengan el enlace aún podrán acceder.</span>";
      $("chooseRecord").innerHTML = "<strong>En el archivo público</strong><span>Permite que esta entrevista aparezca en The Wall, nuestro archivo visible.</span>";
    }
    $("consentTitle").focus();
    askConsentAloud();
    return;
  }
  $("consent").hidden = true;
  processing(true);
  el.end.hidden = false;
  const onRecord = data.visibility === "on-the-record";
  $("visibilityLabel").textContent = language === "es" ? (onRecord ? "En el archivo público" : "Privada") : (onRecord ? "On the Record" : "Private");
  $("visibilityHint").textContent = language === "es"
    ? (onRecord ? "Esta entrevista puede aparecer en The Wall." : "Fuera de The Wall. Quienes tengan el enlace aún pueden acceder.")
    : (onRecord ? "This interview can appear on The Wall." : "Kept off The Wall. People with this interview link can still access it.");
  $("viewWall").hidden = !onRecord;
  $("completeLabel").textContent = language === "es" ? "Entrevista completa" : "Interview complete";
  $("anotherInterview").textContent = language === "es" ? "Empezar otra entrevista" : "Start another interview";
  $("viewWall").textContent = language === "es" ? "Ver en The Wall" : "View on The Wall";
  const first = (assignment?.subjectName || "").split(" ")[0];
  el.thanks.textContent = T.thanks(first);
  const mins = data.startedAt ? Math.max(0, Math.round(((data.endedAt || Date.now()) - data.startedAt) / 60000)) : 0;
  questionCount = (data.turns || []).filter(t => t.speaker === "interviewer").length;
  el.endStats.textContent = mins === 0
    ? (language === "es" ? `${questionCount} preguntas en menos de un minuto.` : `${questionCount} questions in under a minute.`)
    : T.stats(questionCount, mins);
  if (data?.endedReason === "screened") {
    showAlert();
    if (el.writing) {
      el.writing.textContent = language === "es"
        ? "Esta entrevista se cerró antes de tiempo, así que no se redactó nada y queda privada."
        : "This interview was ended early, so nothing was written up and it stays private.";
    }
    if (el.endBar) el.endBar.hidden = true;
    if (el.mailForm) el.mailForm.hidden = true;
    $("viewWall").hidden = true;
    return;
  }
  copyTries = 0;
  waitForCopy();
}

let awaitingConsent = false;
let consentAttempt = 1;

/**
 * Ask it in the interviewer's own voice and listen for the answer. The two
 * buttons stay on screen as a fallback — but nobody should have to click to
 * answer a question a person just asked them out loud.
 */
async function askConsentAloud() {
  if (awaitingConsent) return;
  awaitingConsent = true;
  try {
    const r = await fetch(`/api/interviews/${interviewId}/consent-prompt`);
    const { question } = await r.json();
    if (!question) return;
    await say(question);
    if (mode !== "text") {
      $("consentStatus").textContent = language === "es"
        ? "Contéstame en voz alta, o toca una opción."
        : "Answer out loud, or tap an option.";
      startListening();
    }
  } catch {
    awaitingConsent = false;
  }
}

/** Their spoken answer to the visibility question. */
async function submitSpokenConsent(text) {
  stopListening();
  $("consentError").textContent = "";
  $("consentStatus").textContent = language === "es" ? "Un momento…" : "One moment…";
  try {
    const r = await fetch(`/api/interviews/${interviewId}/consent-voice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, attempt: consentAttempt }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || T.failed);

    // Too vague to act on. Ask again once, then the server settles on private.
    if (data.unclear) {
      consentAttempt = data.attempt || consentAttempt + 1;
      $("consentStatus").textContent = "";
      await say(data.say);
      if (mode !== "text") startListening();
      return;
    }
    awaitingConsent = false;
    $("consentStatus").textContent = "";
    if (data.say) await say(data.say);
    showEnd(data);
  } catch (e) {
    $("consentStatus").textContent = "";
    $("consentError").textContent = e.message;
    if (mode !== "text") startListening();
  }
}

async function chooseVisibility(visibility) {
  awaitingConsent = false;
  stopListening();
  $("choosePrivate").disabled = $("chooseRecord").disabled = true;
  $("consentError").textContent = "";
  $("consentStatus").textContent = language === "es" ? "Guardando tu elección…" : "Saving your choice…";
  try {
    const r = await fetch(`/api/interviews/${interviewId}/consent`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visibility }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || T.failed);
    showEnd(data);
  } catch (e) { $("consentError").textContent = e.message; }
  finally {
    $("consentStatus").textContent = "";
    $("choosePrivate").disabled = $("chooseRecord").disabled = false;
  }
}
$("choosePrivate").onclick = () => chooseVisibility("private");
$("chooseRecord").onclick = () => chooseVisibility("on-the-record");

el.pdf && (el.pdf.onclick = async () => {
  el.pdf.disabled = true;
  $("actionStatus").textContent = language === "es" ? "Preparando PDF…" : "Preparing PDF…";
  try {
    const r = await fetch(`/api/interviews/${interviewId}/pdf`);
    if (!r.ok) throw new Error((await r.json()).error || T.failed);
    const url = URL.createObjectURL(await r.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `prologue-${interviewId}.pdf`;
    document.body.appendChild(link);
    link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("actionStatus").textContent = language === "es" ? "PDF descargado." : "PDF downloaded.";
  } catch (e) { $("actionStatus").textContent = e.message; }
  finally { el.pdf.disabled = false; }
});

$("copySummary").onclick = async () => {
  try {
    if (!navigator.clipboard || !resultText) throw new Error(language === "es" ? "No se pudo copiar. Selecciona el texto y cópialo manualmente." : "Could not copy. Select the summary text and copy it manually.");
    await navigator.clipboard.writeText(resultText);
    $("copySummary").textContent = T.copied;
    $("actionStatus").textContent = T.copied;
    setTimeout(() => { $("copySummary").textContent = language === "es" ? "Copiar resumen" : "Copy summary"; }, 1800);
  } catch (e) { $("actionStatus").textContent = e.message; }
};

$("emailToggle").onclick = () => {
  const form = $("emailForm");
  form.hidden = !form.hidden;
  $("emailToggle").setAttribute("aria-expanded", String(!form.hidden));
  if (!form.hidden) $("summaryEmail").focus();
};

$("emailForm").onsubmit = async event => {
  event.preventDefault();
  if (!$("emailForm").reportValidity() || $("sendEmail").disabled) return;
  $("sendEmail").disabled = true;
  $("emailStatus").textContent = language === "es" ? "Enviando…" : "Sending…";
  try {
    const r = await fetch(`/api/interviews/${interviewId}/email`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: $("summaryEmail").value.trim() }),
    });
    const data = await r.json();
    if (!r.ok || !data.sent) throw new Error(data.error || T.failed);
    $("emailStatus").textContent = language === "es" ? "Resumen enviado. Revisa tu bandeja de entrada." : "Summary sent. Check your inbox.";
  } catch (e) { $("emailStatus").textContent = e.message; }
  finally { $("sendEmail").disabled = !completedInterview?.emailEnabled; }
};

/* The payoff. The subject is still standing there — show them their post. */
let copyTries = 0;
async function waitForCopy() {
  if (!el.copy) return;
  try {
    const r = await fetch(`/api/interviews/${interviewId}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || T.failed);
    if (data.assignment) assignment = data.assignment;
    completedInterview = data;
    resultText = data.summaryText || "";
    const c = data.content;

    if (c && c.error) return failed(c.error);
    if (c && (c.summary || c.instagramCaption || c.nail)) {
      processing(false);
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
      processing(false);
      if (el.writing) el.writing.textContent = T.nothing;
      return;
    }
  } catch {}

  if (++copyTries > 40) return failed();
  setTimeout(waitForCopy, 3000);
}

/** Say so, and offer the retry. Silence is the worst possible answer here. */
function failed(detail) {
  processing(false);
  if (el.writing) el.writing.textContent = detail ? `${T.failed} (${detail})` : T.stillWriting;
  if (!el.copy || el.copy.querySelector("[data-retry]")) return;
  const b = document.createElement("button");
  b.className = "copybtn";
  b.setAttribute("data-retry", "1");
  b.textContent = T.retry;
  b.onclick = async () => {
    b.disabled = true;
    processing(true);
    if (el.writing) el.writing.textContent = T.writing;
    try {
      const r = await fetch(`/api/interviews/${interviewId}/content?force=1`, { method: "POST" });
      const c = await r.json();
      if (!r.ok || c.error) throw new Error(c.error || "failed");
      copyTries = 0;
      await waitForCopy();
    } catch (e) {
      processing(false);
      b.disabled = false;
      if (el.writing) el.writing.textContent = `${T.failed} (${e.message})`;
    }
  };
  el.copy.appendChild(b);
}

function renderCopy(box, c) {
  processing(false);
  if (el.writing) el.writing.textContent = T.hereItIs;
  el.thanks.textContent = c.nail || T.thanks((assignment?.subjectName || "").split(" ")[0]);
  $("copySummary").textContent = language === "es" ? "Copiar resumen" : "Copy summary";
  $("emailToggle").textContent = language === "es" ? "Enviar por email" : "Email summary";
  $("emailLabel").textContent = language === "es" ? "Envía tu resumen a" : "Send your summary to";
  $("sendEmail").textContent = language === "es" ? "Enviar resumen" : "Send summary";
  $("sendEmail").disabled = !completedInterview?.emailEnabled;
  $("summaryEmail").disabled = !completedInterview?.emailEnabled;
  if (!completedInterview?.emailEnabled) $("emailStatus").textContent = language === "es"
    ? "El email aún no está configurado. Puedes copiar el resumen o descargar el PDF."
    : "Email isn’t set up yet. You can copy the summary or download the PDF.";
  const blocks = [];
  if (c.summary)
    blocks.push(`<div class="out"><h3>${T.hSummary}</h3><p>${escapeHtml(c.summary)}</p></div>`);
  if (c.keyTakeaways?.length) blocks.push(`<div class="out"><h3>${language === "es" ? "Ideas clave" : "Key takeaways"}</h3><ol>${c.keyTakeaways.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ol></div>`);
  if (c.pullQuotes?.length) {
    blocks.push(
      `<div class="out"><h3>${T.hStood}</h3>` +
        c.pullQuotes.slice(0, 3).map((q) => `<p>\u201C${escapeHtml(q.quote)}\u201D</p>`).join("") +
        `</div>`,
    );
  }
  if (c.blogDraft) blocks.push(sect(language === "es" ? "Historia" : "Full story", c.blogDraft));
  if (c.instagramCaption) blocks.push(sect("Instagram", c.instagramCaption));
  if (c.linkedinPost) blocks.push(sect("LinkedIn", c.linkedinPost));
  if (c.xThread?.length) blocks.push(sect("X", c.xThread.join("\n\n")));
  if (c.podcastSegment) blocks.push(sect("Podcast", c.podcastSegment));
  if (completedInterview?.cleanTranscript) blocks.push(`<details><summary>${language === "es" ? "Leer transcripción" : "Read transcript"}</summary><p class="readable-transcript">${escapeHtml(completedInterview.cleanTranscript)}</p></details>`);
  if (OPERATOR && completedInterview?.rawTranscript) blocks.push(`<details><summary>${language === "es" ? "Transcripción original" : "Original transcript"}</summary><p class="readable-transcript">${escapeHtml(completedInterview.rawTranscript)}</p></details>`);
  if (c.corrections) {
    blocks.push(`<p class="checked">${T.checked(c.corrections.length)}</p>`);
  }
  box.innerHTML = blocks.join("");

  box.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        if (!navigator.clipboard) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(btn.getAttribute("data-copy") || "");
        btn.textContent = T.copied;
      } catch {
        btn.textContent = language === "es" ? "Selecciona y copia el texto" : "Select and copy the text";
      }
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
    if (!startedAt || completedInterview) return;
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
