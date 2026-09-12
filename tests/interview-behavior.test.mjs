import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = await mkdtemp(join(tmpdir(), "prologue-behavior-"));
process.env.PROLOGUE_DATA_DIR = dataDir;
process.env.ANTHROPIC_API_KEY = "test-only";
const { app } = await import("../src/server.ts");
const { store } = await import("../src/store.ts");
const { nextQuestion } = await import("../src/interviewer.ts");
const { anthropic } = await import("../src/anthropic.ts");
const { interviewStyle } = await import("../src/interview-styles.ts");
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dataDir, { recursive: true, force: true }); });

let requests = [];
let responseMode = "normal";
let screenStop = false;
anthropic.messages.create = async request => {
  requests.push(request);
  if (request.tool_choice.name === "screen") return { content: [{ type: "tool_use", name: "screen", input: { stop: screenStop, reason: screenStop ? "test screening" : "" } }] };
  if (responseMode === "error") throw new Error("Model unavailable");
  if (responseMode === "missing") return { content: [] };
  if (responseMode === "wrong-phase") return { content: [{ type: "tool_use", name: "ask", input: {
    question: "Tell me about an entirely new topic? And another?", move: "next_beat", should_end: true,
  } }] };
  if (request.tool_choice.name === "intake") return { content: [{ type: "tool_use", name: "intake", input: {
    question: "Let's explore that moment.", collected: { subjectName: "Alex", company: "Studio", angle: "A life-changing move" }, done: true, reasoning: "Ready",
  } }] };
  const closing = request.system.includes("CLOCK: CLOSING:");
  const thanks = request.system.includes("They have finished their final answer");
  return { content: [{ type: "tool_use", name: "ask", input: {
    question: thanks ? "Thank you for giving this story your time." : closing ? "What else would you like people to understand before we finish?" : "What happened in that moment?",
    move: closing ? "close" : "follow_up", topic: "moment", reasoning: "Listen", beats_now_covered: [], should_end: thanks,
  } }] };
};
async function api(path, body) {
  const r = await fetch(base + path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
}
const assignment = (extra = {}) => ({ id: "a", subjectName: "Alex", company: "", angle: "A turning point", beats: ["Origins", "Lessons"], durationMinutes: 10, ...extra });
const interview = (elapsed = 0, count = 1) => ({ id: "i", assignmentId: "a", phase: "interview", startedAt: Date.now() - elapsed * 60000,
  turns: Array.from({ length: count }, () => [{ speaker: "interviewer", text: "What happened?", phase: "interview", topic: "same" }, { speaker: "subject", text: "An important experience.", phase: "interview" }]).flat(), beatsCovered: {},
});

test("style defaults are localized, custom angle/beats and legacy requests remain compatible", async () => {
  for (const interviewType of ["career", "founder", "personal", "expert"]) {
    for (const language of ["en", "es"]) {
      const { data: a } = await api("/api/assignments", { subjectName: "Alex", interviewType, language });
      assert.equal(a.durationMinutes, 10);
      assert.equal(a.maxQuestions, undefined);
      assert.equal(a.angle, interviewStyle(interviewType, language).angle);
      assert.deepEqual(a.beats, interviewStyle(interviewType, language).beats);
      await nextQuestion(a, interview());
      assert.ok(requests.at(-1).system.includes(`INTERVIEW LENS: ${a.angle}`));
      if (language === "es") assert.match(requests.at(-1).system, /Everything you say is in Spanish/);
    }
  }
  const { data: custom } = await api("/api/assignments", { subjectName: "Alex", interviewType: "career", angle: "My angle", beats: ["My beat"], durationMinutes: 5, maxQuestions: 10 });
  assert.equal(custom.angle, "My angle");
  assert.deepEqual(custom.beats, ["My beat"]);
  assert.equal(custom.durationMinutes, 5);
  assert.equal(custom.maxQuestions, 10);
  const { data: legacy } = await api("/api/assignments", { subjectName: "Alex", angle: "Legacy angle" });
  assert.equal(legacy.interviewType, undefined);
  assert.equal(legacy.angle, "Legacy angle");
  assert.equal((await api("/api/quickstart", { interviewType: "invalid" })).status, 400);
});

test("guided intake refines angle without losing the chosen style or beats", async () => {
  for (const interviewType of ["career", "founder", "personal", "expert"]) {
    const { data: room } = await api("/api/quickstart", { interviewType, language: "es", durationMinutes: 5, maxQuestions: 10 });
    await api(`/api/interviews/${room.id}/start`, {});
    const { data } = await api(`/api/interviews/${room.id}/answer`, { text: "I'm Alex, and a move changed my life." });
    assert.equal(data.assignment.interviewType, interviewType);
    assert.equal(data.assignment.angle, "A life-changing move");
    assert.deepEqual(data.assignment.beats, room.assignment.beats);
    assert.equal(data.assignment.maxQuestions, 10);
    assert.ok(requests.at(-1).system.includes(interviewStyle(interviewType, "es").angle));
    if (interviewType === "personal") {
      assert.ok(requests.some(r => r.tool_choice.name === "intake" && r.system.includes("instead of requiring their work or business")));
    }
  }
});

test("unlimited interviews have no inferred question cap and use configured duration", async () => {
  const q = await nextQuestion(assignment({ durationMinutes: 5 }), interview(2, 30));
  assert.equal(q.should_end, false);
  assert.equal(q.move, "follow_up");
  assert.match(requests.at(-1).system, /There is no question limit/);
  assert.match(requests.at(-1).system, /of 5 minutes/);
  assert.doesNotMatch(requests.at(-1).system, /You have ten minutes/);
});

test("final minute invites one final answer, then closes even after the duration expires", async () => {
  const i = interview(9.1, 4);
  const first = await nextQuestion(assignment(), i);
  assert.equal(first.move, "close");
  assert.equal(first.should_end, false);
  assert.equal(i.closingQuestionAsked, true);
  assert.doesNotMatch(requests.at(-1).system, /STOP — your last two questions/);
  i.turns.push({ speaker: "interviewer", text: first.question, move: "close" });
  i.startedAt = Date.now() - 12 * 60000;
  i.turns.push({ speaker: "subject", text: "My full, uncut final answer." });
  const last = await nextQuestion(assignment(), i);
  assert.equal(last.should_end, true);
  assert.doesNotMatch(last.question, /\?/);
});

test("closing begins precisely at the final-minute answer boundary", async () => {
  const realNow = Date.now;
  Date.now = () => 1_000_000;
  try {
    assert.equal((await nextQuestion(assignment(), interview(8.99))).move, "follow_up");
    assert.equal((await nextQuestion(assignment(), interview(9))).move, "close");
  } finally { Date.now = realNow; }
});

test("explicit limits reserve the final question, excluding intake", async () => {
  const i = interview(2, 9);
  i.turns.unshift(...Array.from({ length: 3 }, () => ({ speaker: "interviewer", text: "Your name?", phase: "intake" })));
  const q = await nextQuestion(assignment({ maxQuestions: 10 }), i);
  assert.equal(q.move, "close");
  assert.equal(q.should_end, false);
  i.turns.push({ speaker: "interviewer", text: q.question, phase: "interview" }, { speaker: "subject", text: "That's everything.", phase: "interview" });
  assert.equal((await nextQuestion(assignment({ maxQuestions: 10 }), i)).should_end, true);
});

test("server hard limit screens the final answer and delivers a localized goodbye", async () => {
  for (const stop of [false, true]) {
    const { data: a } = await api("/api/assignments", { subjectName: "Alex", language: "es", maxQuestions: 2 });
    const { data: room } = await api("/api/interviews", { assignmentId: a.id });
    await api(`/api/interviews/${room.id}/start`, {});
    await api(`/api/interviews/${room.id}/answer`, { text: "The first answer." });
    assert.equal(store.getInterview(room.id).closingQuestionAsked, true);
    screenStop = stop;
    try {
      const { data: end } = await api(`/api/interviews/${room.id}/answer`, { text: "The final answer." });
      assert.equal(end.interview.status, "finished");
      if (stop) {
        assert.equal(end.interview.endedReason, "screened");
        assert.equal(end.interview.visibility, "private");
      } else {
        assert.equal(end.limitReached, true);
        assert.match(end.say, /Gracias/);
        assert.doesNotMatch(end.say, /[?¿]/);
      }
    } finally { screenStop = false; }
  }
});

test("closing failures use localized final invitations and thanks rather than new threads", async () => {
  for (const mode of ["missing", "error", "wrong-phase"]) {
    responseMode = mode;
    const i = interview(11);
    const q = await nextQuestion(assignment({ language: "es" }), i);
    assert.match(q.question, /Antes de terminar/);
    assert.equal(q.should_end, false);
    i.turns.push({ speaker: "interviewer", text: q.question }, { speaker: "subject", text: "Gracias." });
    const end = await nextQuestion(assignment({ language: "es" }), i);
    assert.match(end.question, /Gracias/);
    assert.equal(end.should_end, true);
  }
  responseMode = "normal";
});

test("closing marker persists; final answer completes privately and retains consent gating", async () => {
  const { data: a } = await api("/api/assignments", { subjectName: "Alex", interviewType: "personal" });
  const { data: room } = await api("/api/interviews", { assignmentId: a.id });
  await api(`/api/interviews/${room.id}/start`, {});
  store.getInterview(room.id).startedAt = Date.now() - 9.5 * 60000;
  const { data: close } = await api(`/api/interviews/${room.id}/answer`, { text: "The current thread's answer." });
  assert.equal(close.interview.status, "live");
  const snapshot = JSON.parse(await readFile(join(dataDir, "store.json"), "utf8"));
  assert.equal(snapshot.interviews[room.id].closingQuestionAsked, true);
  store.getInterview(room.id).startedAt = Date.now() - 12 * 60000;
  const { data: end } = await api(`/api/interviews/${room.id}/answer`, { text: "My complete final answer beyond the time limit." });
  assert.equal(end.interview.status, "finished");
  assert.ok(end.interview.turns.some(t => t.text === "My complete final answer beyond the time limit."));
  assert.equal(end.interview.visibility, "private");
  assert.equal((await api(`/api/interviews/${room.id}/content`, {})).status, 409);
});
