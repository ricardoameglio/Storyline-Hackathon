import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../public/interview.js", import.meta.url), "utf8");
const themeSource = await readFile(new URL("../public/theme.js", import.meta.url), "utf8");
const settle = () => new Promise(resolve => setImmediate(resolve));

async function room(handler, options = {}) {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, {
      hidden: ["live", "end"].includes(id), disabled: false, value: "", textContent: "", innerHTML: "",
      dataset: {}, style: {}, attrs: {}, listeners: {}, children: [],
      classList: { toggle() {}, add() {}, remove() {} },
      setAttribute(key, value) { this.attrs[key] = value; },
      getAttribute(key) { return this.attrs[key]; },
      addEventListener(key, fn) { this.listeners[key] = fn; },
      appendChild(child) { this.children.push(child); },
      querySelector() { return null; }, querySelectorAll() { return []; }, focus() {},
    });
    return elements.get(id);
  };
  let recognizer;
  class Recognition {
    constructor() { recognizer = this; }
    start() {} stop() {}
  }
  const initial = {
    status: "waiting", mode: "text", phase: "interview",
    assignment: { subjectName: "Alex", company: "Studio", durationMinutes: 5, language: options.language || "en" },
    ...options.initial,
  };
  const calls = [];
  const context = vm.createContext({
    document: { getElementById: get, documentElement: {}, createElement: () => get("new-" + elements.size) },
    location: { pathname: "/i/test", search: "?operator=1" }, URLSearchParams,
    window: { SpeechRecognition: Recognition }, Date,
    setTimeout() {}, clearTimeout() {}, setInterval() {},
    navigator: {}, Blob,
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (!init) return { ok: true, json: async () => initial };
      if (url === "/api/tts") return { status: 204 };
      return { ok: true, json: async () => handler(url, init) };
    },
  });
  vm.runInContext(source, context);
  await settle();
  return { get, calls, run: code => vm.runInContext(code, context), recognizer: () => recognizer, initial };
}

test("text interview follows real start/answer events, reports states, and preserves request data", async () => {
  let resolveAnswer;
  const app = await room(url => url.endsWith("/start")
    ? { greeting: "Welcome", question: { question: "What changed?" } }
    : new Promise(resolve => { resolveAnswer = resolve; }));
  assert.equal(app.get("modeText").attrs["aria-pressed"], "true");
  await app.get("start").onclick();
  assert.equal(app.get("question").textContent, "What changed?");
  assert.equal(app.get("sessionState").textContent, "Ready for your answer");
  assert.equal(app.get("questionProgress").textContent, "Question 1");
  app.get("typedText").value = "We opened a new studio.";
  const pending = app.get("next").onclick();
  await settle();
  assert.equal(app.get("sessionState").textContent, "Thinking");
  assert.equal(app.get("swap").disabled, true);
  assert.equal(app.get("repeat").disabled, true);
  const request = app.calls.find(c => c.url.endsWith("/answer"));
  assert.deepEqual(JSON.parse(request.init.body), { text: "We opened a new studio." });
  resolveAnswer({ question: { question: "Why then?" }, interview: { status: "active" } });
  await pending;
  assert.equal(app.get("question").textContent, "Why then?");
  assert.equal(app.get("sessionState").textContent, "Ready for your answer");
  assert.equal(app.get("next").disabled, false);
  assert.equal(app.get("questionProgress").textContent, "Question 2");
});

test("voice mode retains recognition and displays permission errors with a usable text fallback", async () => {
  const app = await room(() => ({ greeting: "Hello", question: { question: "Tell me more" } }));
  await app.get("start").onclick();
  app.get("swap").onclick();
  assert.equal(app.get("sessionState").textContent, "Listening");
  assert.ok(app.recognizer());
  app.recognizer().onerror({ error: "not-allowed" });
  assert.equal(app.get("sessionState").textContent, "Needs attention");
  assert.match(app.get("err").textContent, /permission/);
  app.get("swap").onclick();
  assert.equal(app.get("typed").hidden, false);
  assert.equal(app.get("sessionState").textContent, "Ready for your answer");
});

test("finished content stops processing, escapes output, and retains story formats", async () => {
  const app = await room(() => ({}), { initial: {
    status: "finished", visibility: "private", consentAt: 1, content: { summary: "<script>bad</script>", nail: "A turning point",
      instagramCaption: "Short story", linkedinPost: "Long story", pullQuotes: [{ quote: "We began." }], corrections: [] },
  } });
  assert.equal(app.get("processingTrack").hidden, true);
  assert.equal(app.get("endBar").hidden, false);
  assert.match(app.get("copy").innerHTML, /&lt;script&gt;/);
  assert.match(app.get("copy").innerHTML, /Instagram/);
  assert.match(app.get("copy").innerHTML, /LinkedIn/);
  assert.equal(app.get("writing").textContent, "Your story is ready.");
});

test("Spanish interview labels and processing failures remain actionable", async () => {
  const app = await room(() => ({}), { language: "es", initial: { status: "finished", visibility: "private", consentAt: 1, content: { error: "Unavailable" } } });
  assert.equal(app.get("answerLabel").textContent, "Tu respuesta");
  assert.equal(app.get("processingTrack").hidden, true);
  assert.match(app.get("writing").textContent, /Unavailable/);
  assert.equal(app.get("copy").children[0].textContent, "Intentar de nuevo");
});

function theme(saved, dark = false, blocked = false) {
  const root = { dataset: {} }, control = { value: "", addEventListener: (_, fn) => { control.change = fn; } };
  const media = { matches: dark, addEventListener: (_, fn) => { media.change = fn; } };
  const events = {};
  let stored = saved;
  vm.runInNewContext(themeSource, {
    window: { matchMedia: () => media, addEventListener: (key, fn) => { events[key] = fn; } },
    document: { documentElement: root, getElementById: () => control, addEventListener: (_, fn) => fn() },
    localStorage: { getItem() { if (blocked) throw Error(); return stored; }, setItem(_, value) { if (blocked) throw Error(); stored = value; } },
  });
  return { root, control, media, events, stored: () => stored };
}

test("theme defaults to system, persists overrides, follows system changes only in system mode", () => {
  const app = theme(null, true);
  assert.equal(app.root.dataset.theme, "dark");
  app.control.change({ target: { value: "light" } });
  assert.equal(app.stored(), "light");
  app.media.change();
  assert.equal(app.root.dataset.theme, "light");
  app.events.storage({ key: "prologue-theme", newValue: "system" });
  assert.equal(app.root.dataset.theme, "dark");
  app.media.matches = false;
  app.media.change();
  assert.equal(app.root.dataset.theme, "light");
});

test("theme tolerates blocked storage and invalid preferences", () => {
  const app = theme("invalid", false, true);
  app.control.change({ target: { value: "dark" } });
  assert.equal(app.root.dataset.theme, "dark");
  assert.equal(theme("invalid").root.dataset.theme, "light");
});
