import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const dataDir = await mkdtemp(join(tmpdir(), "prologue-test-"));
process.env.PROLOGUE_DATA_DIR = dataDir;
process.env.ANTHROPIC_API_KEY = "test-only";
process.env.RESEND_API_KEY = "test-only";
process.env.EMAIL_FROM = "Prologue <test@example.com>";
const { app } = await import("../src/server.ts");
const { store } = await import("../src/store.ts");
const { anthropic } = await import("../src/anthropic.ts");
const { preservesWords, formatTranscriptText, prepareTranscript } = await import("../src/transcript.ts");
const { interviewPdf } = await import("../src/pdf.ts");
const raw = "yeah so we started um probably in 2024 and then I guess after like three months we realized it wasn’t working";
const cleaned = "Yeah, so we started probably in 2024. And then, I guess after like three months, we realized it wasn’t working.";
let failGeneration = false;
let failEmail = false;
let cleanupOverride;
let generations = 0;
let sentEmails = [];
let responsiveQuestion;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url) === "https://api.resend.com/emails") {
    sentEmails.push(JSON.parse(options.body));
    await new Promise(resolve => setTimeout(resolve, 120));
    return new Response(JSON.stringify(failEmail ? { error: "test failure" } : { id: "mock-email" }), { status: failEmail ? 500 : 200 });
  }
  // Tests must never contact external services.
  if (!String(url).startsWith("http://127.0.0.1:")) throw new Error(`Unexpected outbound request: ${url}`);
  return realFetch(url, options);
};
anthropic.messages.create = async request => {
  const name = request.tool_choice.name;
  let input;
  if (name === "ask") input = { question: "Thanks for sharing your story.", move: "close", reasoning: "Test close", topic: "story", beats_now_covered: [], should_end: true };
  if (name === "ask" && responsiveQuestion) input = { ...input, question: responsiveQuestion, move: "follow_up", should_end: false };
  if (name === "clean") input = { answers: JSON.parse(request.messages[0].content).map(text => cleanupOverride || (text === raw ? cleaned : formatTranscriptText(text))) };
  if (name === "deliver") {
    generations++;
    await new Promise(resolve => setTimeout(resolve, 40));
    if (failGeneration) throw new Error("Simulated generation failure");
    input = { nail: "Three months changed our direction", summary: "We started in 2024. After three months, we realized it wasn’t working.", keyTakeaways: ["The business started in 2024.", "Three months brought a realization."], pullQuotes: [{ quote: "we realized it wasn’t working", why: "The turning point." }], linkedinPost: "We started in 2024. Three months later, we realized it wasn’t working." };
  }
  if (name === "check") input = { corrections: [] };
  if (!input) throw new Error(`Unexpected model tool: ${name}`);
  return { content: [{ type: "tool_use", name, input }] };
};

let server, base, browser;
const artifactDir = join(process.cwd(), "output", "completion-qa");
before(async () => {
  await mkdir(artifactDir, { recursive: true });
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  globalThis.fetch = realFetch;
  await rm(dataDir, { recursive: true, force: true });
});
async function api(path, body) {
  const response = await fetch(base + path, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
async function finished(name = "Alex Rivera") {
  const { data: a } = await api("/api/assignments", { subjectName: name, company: "Studio", subjectRole: "Founder", language: "en" });
  const { data: i } = await api("/api/interviews", { assignmentId: a.id, mode: "text" });
  assert.equal(i.visibility, "private");
  await api(`/api/interviews/${i.id}/start`, {});
  const ended = await api(`/api/interviews/${i.id}/answer`, { text: raw });
  assert.equal(ended.data.interview.status, "finished");
  return i.id;
}
async function ready(id) {
  for (let n = 0; n < 80; n++) {
    const { data } = await api(`/api/interviews/${id}`);
    if (data.content) return data;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Content never completed");
}
async function pageFor(id, viewport = { width: 1200, height: 900 }) {
  const context = await browser.newContext({ viewport, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${base}/i/${id}`);
  return { page, context, errors };
}

test("consent gates generation, legacy records and private interviews stay off The Wall", async () => {
  const id = await finished();
  const beforeCount = generations;
  assert.equal((await api(`/api/interviews/${id}`)).data.content, undefined);
  assert.equal((await api(`/api/interviews/${id}/content`, {})).status, 409);
  assert.equal((await api(`/api/interviews/${id}/consent`, { visibility: "yes" })).status, 400);
  assert.equal(generations, beforeCount);
  assert.equal((await api("/api/wall")).data.rows.length, 0);
  await api(`/api/interviews/${id}/consent`, { visibility: "private" });
  const result = await ready(id);
  assert.equal(result.rawTranscript.includes(raw), true);
  assert.equal(result.cleanTranscript.includes(cleaned), true);
  assert.equal(result.transcriptCleanup, "cleaned");
  assert.equal(result.turns.find(t => t.speaker === "subject").text, raw);
  const legacy = { ...result, id: "legacy", visibility: undefined, consentAt: undefined };
  store.putInterview(legacy);
  assert.equal((await api("/api/wall")).data.rows.length, 0);
  assert.equal((await api("/api/wall")).data.stats.interviewsFinished, 0);
  const snapshot = JSON.parse(await readFile(join(dataDir, "store.json"), "utf8"));
  assert.equal(snapshot.interviews[id].visibility, "private");
  assert.ok(snapshot.interviews[id].consentAt);
  assert.equal((await api(`/api/interviews/${id}/start`, {})).status, 409);
  assert.equal((await api(`/api/interviews/${id}/answer`, { text: "late" })).status, 409);
});

test("private completion, reload, clipboard, PDF download, email and mobile layout", async () => {
  const id = await finished();
  const { page, context, errors } = await pageFor(id);
  await page.locator("#consent").waitFor({ state: "visible" });
  assert.equal(await page.locator("#end").isVisible(), false);
  await page.screenshot({ path: join(artifactDir, "consent-desktop.png"), fullPage: true });
  await page.locator("#choosePrivate").click();
  await page.locator("#endBar").waitFor({ state: "visible" });
  assert.equal(await page.locator("#visibilityLabel").textContent(), "Private");
  assert.equal(await page.locator("#viewWall").isVisible(), false);
  await page.locator("#copySummary").click();
  await page.waitForFunction(() => document.getElementById("copySummary").textContent === "Copied");
  assert.equal(await page.locator("#copySummary").textContent(), "Copied");
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), (await api(`/api/interviews/${id}`)).data.summaryText);
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#pdf").click();
  const download = await downloadPromise;
  await download.saveAs(join(artifactDir, "interview.pdf"));
  assert.equal((await readFile(join(artifactDir, "interview.pdf"))).subarray(0, 5).toString(), "%PDF-");
  await page.locator("#emailToggle").click();
  await page.locator("#summaryEmail").fill("reader@example.com");
  await page.locator("#sendEmail").click();
  assert.match(await page.locator("#emailStatus").textContent(), /Sending/);
  await page.waitForFunction(() => document.getElementById("emailStatus").textContent.includes("Summary sent"));
  assert.match(sentEmails.at(-1).text, /KEY TAKEAWAYS/);
  assert.match(sentEmails.at(-1).text, /Private/);
  assert.deepEqual(sentEmails.at(-1).to, ["reader@example.com"]);
  await page.screenshot({ path: join(artifactDir, "results-desktop.png"), fullPage: true });
  await page.reload();
  await page.locator("#endBar").waitFor({ state: "visible" });
  assert.equal(await page.locator("#consent").isVisible(), false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(artifactDir, "results-mobile.png"), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test("On the Record is explicit, persists, appears on Wall and can be made private", async () => {
  const id = await finished("Public interview");
  const { page, context, errors } = await pageFor(id, { width: 390, height: 844 });
  await page.locator("#chooseRecord").waitFor({ state: "visible" });
  await page.screenshot({ path: join(artifactDir, "consent-mobile.png"), fullPage: true });
  await page.locator("#chooseRecord").click();
  await page.locator("#endBar").waitFor({ state: "visible" });
  assert.equal(await page.locator("#viewWall").isVisible(), true);
  const wall = (await api("/api/wall")).data;
  assert.deepEqual(wall.rows.map(r => r.interviewId), [id]);
  assert.equal(wall.stats.interviewsFinished, 1);
  await page.reload();
  await page.locator("#viewWall").waitFor({ state: "visible" });
  await api(`/api/interviews/${id}/consent`, { visibility: "private" });
  assert.equal((await api("/api/wall")).data.rows.length, 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test("cleanup rejects invented facts, negations, missing numbers and preserves uncertain wording", async () => {
  assert.equal(preservesWords(raw, cleaned), true);
  assert.equal(preservesWords(raw, cleaned.replace("2024", "2025")), false);
  assert.equal(preservesWords("we did not move", "We did move."), false);
  assert.equal(preservesWords("I guess it cost 600", "It cost 600."), false);
  assert.equal(preservesWords("we we started um yesterday", "We started yesterday."), true);
  const readable = formatTranscriptText(raw);
  assert.match(readable, /^Yeah, so/);
  assert.match(readable, /2024\. And then/);
  assert.ok(!readable.includes(" um "));
  assert.equal(preservesWords(raw, readable), true);
  const interview = { turns: [{ speaker: "subject", text: raw }] };
  cleanupOverride = "We started in 2025.";
  await prepareTranscript({ subjectName: "Alex" }, interview);
  cleanupOverride = undefined;
  assert.equal(interview.transcriptCleanup, "fallback");
  assert.ok(interview.cleanTranscript.includes("2024"));
  assert.ok(!interview.cleanTranscript.includes("2025"));
});

test("generation failures recover without stale errors and concurrent requests share one job", async () => {
  const id = await finished();
  failGeneration = true;
  await api(`/api/interviews/${id}/consent`, { visibility: "private" });
  assert.ok((await ready(id)).content.error);
  failGeneration = false;
  const count = generations;
  const results = await Promise.all([api(`/api/interviews/${id}/content?force=1`, {}), api(`/api/interviews/${id}/content?force=1`, {})]);
  assert.equal(generations, count + 1);
  assert.ok(results.every(r => r.status === 200 && !r.data.error));
  assert.equal((await ready(id)).content.error, undefined);
});

test("email validates addresses and exposes disabled, failure, success and rate limit states", async () => {
  const id = await finished();
  await api(`/api/interviews/${id}/consent`, { visibility: "private" });
  await ready(id);
  assert.equal((await api(`/api/interviews/${id}/email`, { email: "bad" })).status, 400);
  delete process.env.RESEND_API_KEY;
  assert.equal((await api(`/api/interviews/${id}/email`, { email: "reader@example.com" })).status, 503);
  const { page, context, errors } = await pageFor(id);
  await page.locator("#endBar").waitFor({ state: "visible" });
  await page.locator("#emailToggle").click();
  assert.equal(await page.locator("#sendEmail").isDisabled(), true);
  assert.match(await page.locator("#emailStatus").textContent(), /isn’t set up/);
  process.env.RESEND_API_KEY = "test-only";
  await page.reload();
  await page.locator("#endBar").waitFor({ state: "visible" });
  await page.locator("#emailToggle").click();
  await page.locator("#summaryEmail").fill("reader@example.com");
  failEmail = true;
  await page.locator("#sendEmail").click();
  await page.waitForFunction(() => document.getElementById("emailStatus").textContent.includes("not confirmed"));
  assert.equal(await page.locator("#sendEmail").isDisabled(), false);
  failEmail = false;
  await page.locator("#sendEmail").click();
  await page.waitForFunction(() => document.getElementById("emailStatus").textContent.includes("Summary sent"));
  assert.equal((await api(`/api/interviews/${id}/email`, { email: "reader@example.com" })).status, 429);
  assert.deepEqual(errors, []);
  await context.close();
});

test("empty early completion stays usable without waiting for a nonexistent story", async () => {
  const { data: i } = await api("/api/quickstart", {});
  assert.equal((await api(`/api/interviews/${i.id}/consent`, { visibility: "private" })).status, 400);
  await api(`/api/interviews/${i.id}/end`, {});
  const { page, context } = await pageFor(i.id);
  await page.locator("#choosePrivate").click();
  await page.waitForFunction(() => document.getElementById("writing").textContent.includes("Nothing was recorded"));
  assert.equal(await page.locator("#anotherInterview").isVisible(), true);
  assert.equal(await page.locator("#endBar").isVisible(), false);
  await context.close();
});

test("End early saves the current typed answer and failed consent can be retried", async () => {
  const { data: a } = await api("/api/assignments", { subjectName: "Early finish" });
  const { data: i } = await api("/api/interviews", { assignmentId: a.id, mode: "text" });
  const { page, context, errors } = await pageFor(i.id);
  await page.addInitScript(() => { window.speechSynthesis.cancel(); window.speechSynthesis.speak = utterance => utterance.onend?.(); });
  await page.route("**/api/tts", route => route.fulfill({ status: 204 }));
  await page.reload();
  await page.locator("#start").click();
  await page.waitForFunction(() => !document.getElementById("finish").disabled);
  await page.locator("#typedText").fill(raw);
  await page.locator("#finish").click();
  await page.locator("#consent").waitFor({ state: "visible" });
  assert.equal((await api(`/api/interviews/${i.id}`)).data.turns.at(-1).text, raw);
  await page.route("**/consent", route => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Could not save your choice." }) }), { times: 1 });
  await page.locator("#choosePrivate").click();
  await page.waitForFunction(() => document.getElementById("consentError").textContent.includes("Could not save"));
  assert.equal(await page.locator("#end").isVisible(), false);
  await page.locator("#choosePrivate").click();
  await page.locator("#endBar").waitFor({ state: "visible" });
  assert.equal((await api(`/api/interviews/${i.id}`)).data.visibility, "private");
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw Error("Clipboard denied"); } }, configurable: true }));
  await page.locator("#copySummary").click();
  await page.waitForFunction(() => document.getElementById("actionStatus").textContent.includes("Clipboard denied"));
  assert.notEqual(await page.locator("#copySummary").textContent(), "Copied");
  await page.route("**/pdf", route => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "PDF unavailable" }) }));
  await page.locator("#pdf").click();
  await page.waitForFunction(() => document.getElementById("actionStatus").textContent.includes("PDF unavailable"));
  assert.equal(await page.locator("#pdf").isDisabled(), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test("long Spanish PDF wraps across pages", async () => {
  const id = await finished("José García");
  await api(`/api/interviews/${id}/consent`, { visibility: "private" });
  const i = await ready(id);
  const pdf = await interviewPdf({ ...i.assignment, language: "es" }, { ...i, cleanTranscript: "José: Empezamos en 2024. Aprendimos muchísimo durante los primeros tres meses.\n\n".repeat(100) }, { ...i.content, nail: "Una conversación sobre cómo empezar", summary: "Empezamos en 2024. Después de tres meses, cambiamos de dirección." });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(artifactDir, "long-spanish.pdf"), pdf);
  assert.ok(pdf.length > 5000);
});

test("green dropdowns support keyboard selection, dismissal, themes and small viewports", async () => {
  const context = await browser.newContext({ viewport: { width: 320, height: 740 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await page.goto(base);
    const language = page.locator("#language-trigger");
    await language.press("Space");
    assert.equal(await language.getAttribute("aria-expanded"), "true");
    await language.press("End");
    await language.press("Enter");
    assert.equal(await page.locator("#language").inputValue(), "es");
    assert.match(await page.locator("#configSummary").textContent(), /Español/);
    await language.press("Space");
    await language.press("Home");
    await language.press("Escape");
    assert.equal(await page.locator("#language").inputValue(), "es");
    assert.equal(await language.getAttribute("aria-expanded"), "false");
    await language.press("e");
    await language.press("Enter");
    assert.equal(await page.locator("#language").inputValue(), "en");
    for (const theme of ["light", "dark"]) {
      await page.locator("#themeChoice-trigger").click();
      await page.getByRole("option", { name: theme === "dark" ? "Dark" : "Light", exact: true }).click();
      await language.click();
      const selected = page.locator('#language-options [aria-selected="true"]');
      const colors = await selected.evaluate(el => ({ actual: getComputedStyle(el).backgroundColor, token: getComputedStyle(document.documentElement).getPropertyValue("--action").trim() }));
      assert.equal(colors.actual, theme === "dark" ? "rgb(186, 207, 158)" : "rgb(52, 70, 40)");
      const bounds = await page.locator("#language-options").boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 320);
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 740);
      await page.screenshot({ path: join(artifactDir, `dropdown-${theme}-320.png`) });
      await language.press("Tab");
      assert.equal(await language.getAttribute("aria-expanded"), "false");
    }
    await page.reload();
    assert.match(await page.locator("#themeChoice-trigger").textContent(), /Dark/);
    await language.click();
    await page.locator("#subjectName").click();
    assert.equal(await language.getAttribute("aria-expanded"), "false");
  } finally { await context.close(); }
});

test("all app surfaces fit mobile, tablet, desktop and landscape with long content in both themes", async () => {
  const longWord = "LongUnbrokenStory".repeat(18);
  const id = await finished(longWord);
  await api(`/api/interviews/${id}/consent`, { visibility: "on-the-record" });
  const result = await ready(id);
  store.putContent(id, { ...result.content, nail: longWord, summary: longWord, keyTakeaways: [longWord], pullQuotes: [{ quote: longWord, why: longWord }] });
  const { data: liveRoom } = await api("/api/interviews", { assignmentId: result.assignmentId, mode: "text" });
  const consentRoom = { ...result, id: "responsive-consent", consentAt: undefined, visibility: "private" };
  store.putInterview(consentRoom);
  const sizes = [[320, 740], [390, 844], [520, 900], [600, 900], [768, 1024], [1000, 900], [1001, 900], [1024, 768], [1440, 900], [1920, 1080], [844, 390]];
  responsiveQuestion = longWord;
  const check = async (page, surface) => {
    const issues = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const issues = [];
      if (document.documentElement.scrollWidth > width + 1) issues.push(`document: ${document.documentElement.scrollWidth} > ${width}`);
      for (const el of document.querySelectorAll(".assignment,.wall-panel,.choice-card,.style-choice,.journey,.consent-choice,.email-row,.out,.heard,.session-meta,header,button,input,select,textarea")) {
        if (!el.getClientRects().length) continue;
        const rect = el.getBoundingClientRect();
        if (rect.left < -1 || rect.right > width + 1) issues.push(`${el.id || el.className || el.tagName}: outside viewport`);
        if (!el.matches("input,select,textarea") && el.scrollWidth > el.clientWidth + 2) issues.push(`${el.id || el.className}: content overflow ${el.scrollWidth}/${el.clientWidth}`);
      }
      return issues;
    });
    if (issues.length) await page.screenshot({ path: join(artifactDir, "responsive-failure.png"), fullPage: true });
    assert.deepEqual(issues, [], `${surface} at ${JSON.stringify(page.viewportSize())}`);
  };
  for (const theme of ["light", "dark"]) {
    store.putAssignment({ ...result.assignment, language: theme === "dark" ? "es" : "en" });
    for (const [width, height] of sizes) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
      await context.addInitScript(() => {
        // Exercise voice layout without accessing hardware during layout tests.
        window.SpeechRecognition = class { start() {} stop() {} };
      });
      await context.route("**/api/tts", route => route.fulfill({ status: 200, contentType: "audio/mpeg", body: "test-audio" }));
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", e => errors.push(e.message));
      try {
        await page.goto(base);
        await page.locator("#themeChoice-trigger").click();
        await page.getByRole("option", { name: theme === "dark" ? "Dark" : "Light", exact: true }).click();
        await page.locator("#subjectName").fill(longWord);
        await page.locator("#company").fill(longWord);
        await page.locator("#language-trigger").click();
        await page.getByRole("option", { name: "Español", exact: true }).click();
        await page.locator("#settingsPanel summary").click();
        await page.locator("#questionLimit-trigger").click();
        await page.getByRole("option", { name: "Set a limit", exact: true }).click();
        await page.locator(".journey summary").nth(1).click();
        await page.locator(".archive-disclosure summary").click();
        await check(page, "setup, settings, journey and archive");
        if ([320, 768, 1440].includes(width)) await page.screenshot({ path: join(artifactDir, `setup-${theme}-${width}.png`) });
        await page.locator("#guidedMode").check();
        await check(page, "guided setup");
        await page.goto(`${base}/i/${liveRoom.id}?operator=1`);
        await page.locator("#start").waitFor({ state: "visible" });
        await check(page, "interview intro");
        await page.locator("#modeText").click();
        await page.locator("#start").click();
        await page.locator("#typedText").waitFor({ state: "visible" });
        await page.locator("#typedText").fill(longWord);
        await page.locator("#logBox summary").click();
        await check(page, "live text interview and operator transcript");
        if (width === 768) await page.screenshot({ path: join(artifactDir, `live-${theme}-${width}.png`) });
        await page.locator("#swap").click();
        await page.locator("#heard").waitFor({ state: "visible" });
        await check(page, "live voice controls");
        await page.goto(`${base}/i/${consentRoom.id}`);
        await page.locator("#consent").waitFor({ state: "visible" });
        await check(page, "consent");
        await page.goto(`${base}/i/${id}`);
        await page.locator("#endBar").waitFor({ state: "visible" });
        await page.locator("#emailToggle").click();
        await page.locator("#summaryEmail").fill(`${"a".repeat(60)}@example.com`);
        await check(page, "completion, story and email");
        if ([320, 768, 1440].includes(width)) await page.screenshot({ path: join(artifactDir, `responsive-${theme}-${width}.png`), fullPage: true });
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  }
  responsiveQuestion = undefined;
});
