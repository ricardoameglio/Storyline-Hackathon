import { $, esc, request, contentMarkup, contentText } from "./ui.js";

const SILENCE_MS = 2200;
const OPERATOR = new URLSearchParams(location.search).has("operator");
const interviewId = location.pathname.split("/").pop();
const endpoint = `/api/interviews/${encodeURIComponent(interviewId)}`;
let interview = null;
let assignment = null;
let mode = "voice";
let busy = false;
let answerUncertain = false;
let listening = false;
let recog = null;
let finalText = "";
let interimText = "";
let silenceTimer = null;
let clockTimer = null;
let audio = null;
let generatedContent = null;

const supported = () => "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
const draft = () => mode === "text" ? $("answer").value.trim() : `${finalText} ${interimText}`.trim();

function status(text, active = false) {
  $("statusLabel").textContent = text;
  $("dot").classList.toggle("idle", !active);
}

function controls() {
  const live = interview?.status === "live" && !$("live").hidden;
  $("next").disabled = !live || busy || answerUncertain || !draft();
  $("answer").disabled = busy || answerUncertain;
  $("repeat").disabled = !live || busy;
  $("switchMode").disabled = !live || busy || answerUncertain;
  $("finish").disabled = !live || busy;
}

function setMode(value) {
  const previousDraft = draft();
  stopListening();
  mode = value;
  document.querySelectorAll('input[name="mode"]').forEach((input) => { input.checked = input.value === mode; });
  $("voiceAnswer").hidden = mode === "text";
  $("textAnswer").hidden = mode !== "text";
  $("switchMode").textContent = mode === "text" ? "Switch to voice" : "Switch to text";
  $("next").textContent = mode === "text" ? "Send answer ↗" : "Done answering";
  $("modeHint").textContent = mode === "text" ? "Write your answers at your own pace. No microphone needed." : "Voice works best in Chrome. Your microphone is used only while you answer.";
  if (mode === "text") $("answer").value = previousDraft;
  else { finalText = previousDraft; interimText = ""; }
  if (!$("live").hidden && !busy && !answerUncertain) startListening();
  controls();
}

document.querySelectorAll('input[name="mode"]').forEach((input) => input.addEventListener("change", () => setMode(input.value)));
$("answer").addEventListener("input", controls);
$("switchMode").onclick = () => setMode(mode === "voice" ? "text" : "voice");

function paintInterview(data) {
  interview = data;
  const questions = data.turns.filter((turn) => turn.speaker === "interviewer");
  $("questionNumber").textContent = `QUESTION ${String(questions.length).padStart(2, "0")}`;
  const beats = Object.values(data.beatsCovered || {});
  $("beatProgress").textContent = beats.length ? `${beats.filter(Boolean).length} of ${beats.length} topics explored` : "";
  if (questions.length) $("question").textContent = questions.at(-1).text;
  if (OPERATOR) $("log").innerHTML = data.turns.map((turn) => `<div class="t ${turn.speaker === "subject" ? "a" : "q"}"><b>${esc(turn.speaker === "subject" ? assignment.subjectName : turn.move || "Interviewer")}</b>${esc(turn.text)}${turn.reasoning ? `<div class="why">${esc(turn.reasoning)}</div>` : ""}</div>`).join("");
  tickClock();
}

function tickClock() {
  const seconds = interview?.startedAt ? Math.max(0, Math.floor(((interview.endedAt || Date.now()) - interview.startedAt) / 1000)) : 0;
  $("clock").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

async function boot() {
  try {
    const data = await request(endpoint);
    assignment = data.assignment;
    generatedContent = data.content;
    $("subjectLabel").textContent = `${assignment.subjectName} · ${assignment.company}`;
    $("briefPreview").textContent = assignment.angle;
    $("briefPreview").hidden = false;
    $("logBox").hidden = !OPERATOR;
    paintInterview(data);
    if (data.status === "finished") return showEnd();
    const hasTurns = data.turns.length > 0;
    $("greeting").textContent = `Hi ${assignment.subjectName.split(" ")[0]} — ready when you are.`;
    $("introHint").textContent = hasTurns ? "Your conversation is saved. Continue from where you left off." : `About ${assignment.durationMinutes} minutes on ${assignment.company}. Take a breath. There are no perfect answers.`;
    $("start").textContent = hasTurns ? "Continue the conversation ↗" : "Start the conversation ↗";
    $("start").disabled = false;
    status(hasTurns ? "Ready to continue" : "Ready when you are");
  } catch (error) {
    $("greeting").textContent = "We couldn’t open this room.";
    $("introHint").textContent = "Check the interview link or reload to try again.";
    $("introError").textContent = error.message;
    status("Room unavailable");
  }
}

function buildRecognizer() {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognizer = new Ctor();
  recognizer.continuous = true;
  recognizer.interimResults = true;
  recognizer.lang = "en-US";
  recognizer.onresult = (event) => {
    if (!listening || busy) return;
    interimText = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) finalText += event.results[i][0].transcript + " ";
      else interimText += event.results[i][0].transcript;
    }
    paintHeard();
    $("lvl").style.width = "75%";
    setTimeout(() => { $("lvl").style.width = "0%"; }, 260);
    resetSilence();
  };
  recognizer.onerror = (event) => {
    if (["no-speech", "aborted"].includes(event.error)) return;
    if (!listening) return;
    setMode("text");
    $("err").textContent = event.error === "not-allowed" ? "Microphone access is blocked. You can type your answer below." : "Voice recognition is unavailable. Continue by typing your answer.";
  };
  recognizer.onend = () => { if (listening) { try { recognizer.start(); } catch { /* Already restarting. */ } } };
  return recognizer;
}

function startListening() {
  if (interview?.status !== "live" || answerUncertain) return;
  if (mode === "text") {
    status("Your turn");
    $("hint").textContent = "Take your time. Send when you’re ready.";
    controls();
    return;
  }
  if (!supported()) {
    setMode("text");
    $("err").textContent = "This browser doesn’t support voice recognition. Text mode is ready to use.";
    return;
  }
  listening = true;
  status("Listening", true);
  $("hint").textContent = "We’ll send after a pause, or press Done answering.";
  recog = recog || buildRecognizer();
  try { recog.start(); } catch { /* Recognition may already be active. */ }
  paintHeard();
  resetSilence();
}

function stopListening() {
  listening = false;
  clearTimeout(silenceTimer);
  if (recog) { try { recog.stop(); } catch { /* Already stopped. */ } }
  $("lvl").style.width = "0%";
  $("dot").classList.add("idle");
}

function resetSilence() {
  clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => { if (listening && draft()) submitAnswer(); }, SILENCE_MS);
}

function paintHeard() {
  $("heard").innerHTML = draft() ? esc(draft()) : '<span class="ph">Your words will appear here.</span>';
  controls();
}

async function say(text, force = false) {
  stopListening();
  if (mode === "text" && !force) return;
  status("Interviewer speaking", true);
  $("hint").textContent = "A moment to listen, then it’s your turn.";
  try {
    const response = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(15000) });
    if (response.status === 204 || !response.ok) return await browserVoice(text);
    const url = URL.createObjectURL(await response.blob());
    try {
      audio = new Audio(url);
      await new Promise((resolve) => {
        const timer = setTimeout(done, 45000);
        function done() { clearTimeout(timer); audio.pause(); resolve(); }
        audio.onended = done;
        audio.onerror = done;
        audio.play().catch(done);
      });
    } finally { URL.revokeObjectURL(url); audio = null; }
  } catch { await browserVoice(text); }
}

function browserVoice(text) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) return resolve();
    const utterance = new SpeechSynthesisUtterance(text);
    const timer = setTimeout(() => { speechSynthesis.cancel(); resolve(); }, 45000);
    utterance.rate = 1.02;
    utterance.onend = utterance.onerror = () => { clearTimeout(timer); resolve(); };
    speechSynthesis.speak(utterance);
  });
}

$("start").onclick = async () => {
  if (busy) return;
  busy = true;
  $("start").disabled = true;
  $("introError").textContent = "";
  status("Preparing your interview");
  try {
    // /start resets the transcript. Never call it to resume an existing conversation.
    if (!interview.turns.length) {
      const data = await request(`${endpoint}/start`, {});
      paintInterview(data.interview);
      await say(data.greeting);
    }
    $("intro").hidden = true;
    $("live").hidden = false;
    clearInterval(clockTimer);
    clockTimer = setInterval(tickClock, 1000);
    answerUncertain = interview.turns.at(-1)?.speaker === "subject";
    if (answerUncertain) $("err").textContent = "Your last answer was saved, but its follow-up is unavailable. Finish this interview to keep the transcript for your editor.";
    else await say($("question").textContent);
    $("question").focus();
  } catch (error) {
    $("introError").textContent = error.message;
    // Re-read before retrying: a lost response may still have saved the question.
    await boot();
  } finally {
    busy = false;
    controls();
    if (!$("live").hidden) startListening();
  }
};

$("next").onclick = submitAnswer;
$("repeat").onclick = async () => {
  if (busy) return;
  busy = true; controls();
  await say($("question").textContent, true);
  busy = false; controls(); startListening();
};
$("finish").onclick = async () => {
  if (busy) return;
  busy = true; stopListening(); controls();
  $("err").textContent = "";
  status("Saving conversation");
  try { paintInterview(await request(`${endpoint}/end`, {})); showEnd(); }
  catch (error) { $("err").textContent = `Couldn’t finish the interview. ${error.message}`; status("Couldn’t save"); }
  finally { busy = false; controls(); }
};

async function submitAnswer() {
  const text = draft();
  if (busy || answerUncertain || !text) return;
  busy = true;
  stopListening(); controls();
  $("err").textContent = "";
  $("hint").textContent = "Finding the next question…";
  status("Following up");
  const previousTurnCount = interview.turns.length;
  let readyForNext = true;
  try {
    const data = await request(`${endpoint}/answer`, { text });
    paintInterview(data.interview);
    finalText = ""; interimText = ""; $("answer").value = ""; paintHeard();
    await say(data.question.question);
    if (data.interview.status === "finished") return showEnd();
    $("question").focus();
  } catch (error) {
    // The backend persists the answer before generating a follow-up. Blind retry duplicates it.
    readyForNext = false;
    answerUncertain = true;
    try {
      const latest = await request(endpoint);
      paintInterview(latest);
      if (latest.turns.length === previousTurnCount) answerUncertain = false;
      else if (latest.turns.at(-1)?.speaker === "interviewer") {
        answerUncertain = false;
        readyForNext = true;
        finalText = ""; interimText = ""; $("answer").value = ""; paintHeard();
        if (latest.status === "finished") return showEnd();
        await say($("question").textContent);
        $("question").focus();
      }
    } catch { /* Keep submission locked until the saved state can be checked. */ }
    if (!readyForNext) {
      $("err").textContent = answerUncertain ? "Your answer may already be saved, but the follow-up could not be loaded. Reload to check the conversation, or finish to preserve it for your editor." : error.message;
      $("hint").textContent = answerUncertain ? "Answer preserved. Check the saved conversation before continuing." : "Your answer is still here. Press Send or Done answering to retry.";
      status("Needs attention");
    }
  } finally { busy = false; controls(); }
  if (readyForNext) startListening();
}

function showEnd() {
  stopListening();
  clearInterval(clockTimer);
  $("intro").hidden = true; $("live").hidden = true; $("end").hidden = false;
  status("Conversation complete");
  $("thanks").textContent = `Thank you, ${assignment.subjectName.split(" ")[0]}.`;
  const questions = interview.turns.filter((turn) => turn.speaker === "interviewer").length;
  $("endStats").textContent = `${questions} questions · ${$("clock").textContent} on the record`;
  $("editorResults").hidden = !OPERATOR;
  if (OPERATOR && generatedContent) showContent(generatedContent);
  else if (OPERATOR && !interview.turns.some((turn) => turn.speaker === "subject")) {
    $("generate").disabled = true;
    $("resultError").textContent = "No answers were recorded, so there isn’t a story to generate yet.";
  }
}

function showContent(content) {
  generatedContent = content;
  $("generatePrompt").hidden = true;
  $("result").innerHTML = contentMarkup(content);
  $("result").hidden = false;
  $("resultActions").hidden = false;
}

$("generate").onclick = async () => {
  if ($("generate").disabled) return;
  $("generate").disabled = true;
  $("generatePrompt").hidden = true;
  $("processing").hidden = false;
  $("resultError").textContent = "";
  try { showContent(await request(`${endpoint}/content`, {})); }
  catch (error) { $("resultError").textContent = error.message; $("generatePrompt").hidden = false; }
  finally { $("processing").hidden = true; $("generate").disabled = false; }
};
$("copyStory").onclick = async () => {
  try { await navigator.clipboard.writeText(contentText(generatedContent)); $("copyStatus").textContent = "Copied to clipboard."; }
  catch { $("copyStatus").textContent = "Copy unavailable. Select the story text to copy it manually."; }
};

window.addEventListener("pagehide", () => {
  stopListening(); clearInterval(clockTimer);
  if (audio) audio.pause();
  window.speechSynthesis?.cancel();
});
if (!supported()) setMode("text");
boot();
