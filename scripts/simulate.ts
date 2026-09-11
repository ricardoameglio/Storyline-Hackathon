/**
 * End-to-end dry run without a microphone.
 *
 * Runs a full interview against a scripted food-hall vendor, prints every
 * question with the reasoning behind it, then generates the copy. Use it to
 * check the whole loop after you set your key, and to rehearse the demo
 * without putting a human in front of it.
 *
 *   npm run simulate
 */
import "dotenv/config";

const API = process.env.API_BASE || `http://localhost:${process.env.PORT || 8787}`;

/** A stubborn, slightly shy vendor — the realistic case, not the easy one. */
const ANSWERS = [
  "Uh, sure. So we do birria tacos, mostly. Been here about two years now.",
  "It's fine. Good days and bad days, you know.",
  "I mean the first week was rough. Nobody came. I think we sold like eleven tacos on a Tuesday.",
  "My wife wanted to quit. I told her give it till Derby. We had four hundred dollars left and rent was six.",
  "Derby weekend a guy posted a video of the cheese pull and it did like two hundred thousand views overnight. Line went around the building on Sunday.",
  "Honestly they say it tastes like their grandmother's. People cry sometimes. A lady cried last month.",
  "That it takes eighteen hours. Everybody thinks you just throw it in a pot. I start the consomé at four in the morning.",
  "We want a second stall, maybe out east. And I want my mom to see it before she goes back to Jalisco.",
  "I guess you didn't ask why I named it Red Bird. It was my dad's nickname for my mom.",
];

async function post(path: string, body?: unknown) {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || `${r.status} ${path}`);
  return d as any;
}

const rule = (s: string) => console.log(`\n${"─".repeat(64)}\n${s}\n`);

const assignment = await post("/api/assignments", {
  subjectName: "Marcus Webb",
  subjectRole: "owner",
  company: "Red Bird Tacos",
  angle: "Why a line forms outside a stall that has never advertised.",
  // Short on purpose: the script is only nine answers long, so a 10-minute
  // budget would never exercise the closing question. Six makes the sim
  // actually land the plane the way a real interview does.
  durationMinutes: 6,
  deliverables: ["pull_quotes", "instagram_caption", "linkedin_post"],
});
console.log(`assignment ${assignment.id}`);

const interview = await post("/api/interviews", { assignmentId: assignment.id });
console.log(`interview  ${interview.id}\nroom       ${interview.url}`);

rule("INTERVIEW");
const started = await post(`/api/interviews/${interview.id}/start`);
let q = started.question;
console.log(`Q: ${q.question}\n   ↳ [${q.move}] ${q.reasoning}`);

for (const answer of ANSWERS) {
  console.log(`\nA: ${answer}`);
  const res = await post(`/api/interviews/${interview.id}/answer`, { text: answer });
  q = res.question;
  console.log(`\nQ: ${q.question}\n   ↳ [${q.move}] ${q.reasoning}`);
  if (res.interview.status === "finished") break;
}
await post(`/api/interviews/${interview.id}/end`);

rule("COPY");
const c = await post(`/api/interviews/${interview.id}/content`);
if (c.summary) console.log(`SUMMARY\n${c.summary}\n`);
console.log(`CONTEXT GAP\n${c.contextGap}\n`);
console.log(`THE NAIL\n${c.nail}\n`);
for (const p of c.pullQuotes ?? []) console.log(`"${p.quote}"\n  — ${p.why}\n`);
if (c.instagramCaption) console.log(`INSTAGRAM\n${c.instagramCaption}\n`);
if (c.linkedinPost) console.log(`LINKEDIN\n${c.linkedinPost}\n`);

rule("FACT-CHECK");
if (c.corrections?.length) {
  console.log(`${c.corrections.length} unsupported claim(s) caught before delivery:\n`);
  for (const x of c.corrections) {
    console.log(`[${x.field}] "${x.claim}"\n  problem: ${x.problem}\n  fix: ${x.fix}\n`);
  }
} else {
  console.log("Clean — every claim traced back to the transcript.");
}

rule("Check: did it chase the $400/rent line and the 4am detail? That's the product.");
