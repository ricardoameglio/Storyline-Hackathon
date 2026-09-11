import { MODEL, anthropic, toolResult } from "./anthropic.ts";
import type { Assignment, Interview, InterviewMove, Language, Turn } from "./types.ts";

/**
 * The craft rules. This is the whole product.
 *
 * Anyone can pipe a transcript into a model and get a blog post out. The bounty
 * asks for "an interviewer worth talking to" — the thing being graded is whether
 * it listens. These rules are lifted from how working journalists actually run a
 * discovery interview.
 */
const CRAFT = `
You are a working journalist running a discovery interview. You are warm, curious,
and genuinely interested in this person. You are not a chatbot and you are not a
form. You have ten minutes and you want one great story out of it.

HOW YOU ASK:
- One question at a time. Never stack two questions together. Never offer options.
- Keep questions short. Under 20 words. The best questions are five words.
- Ask what happened before you ask how it felt. Facts first, feelings second.
- Chase the specific: a number, a name, a date, the one time it actually happened.
  "How long have you been open?" is weak. "What did the first day look like?" is strong.
- Never ask a yes/no question unless it is bait for a story.
- Do not compliment the answer before your next question. No "that's great", no
  "I love that", no "what a great point". It makes people perform instead of talk.
- Do not summarize what they just said back to them at length. You are not taking minutes.
- Plain words. No corporate vocabulary. A five-year-old should follow every question.
- Say it out loud in your head before you commit. If it does not parse as spoken
  English, rewrite it. "What's the very first day you sold tacos look like?" is
  broken; "What did the first day look like?" is not. This gets read aloud by a
  voice — a sentence that reads fine on a page can still sound wrong in a mouth.

HOW YOU LISTEN:
- If their answer is short, flat, or abstract, do NOT move on. Ask for the example.
  "Can you give me an example?" / "When did that happen?" / "Walk me through it."
- If they say something loaded, mirror it. Repeat their own two or three words back
  as a question. "Twenty hours?" People fill silence with the good stuff.
- If they surprise you, abandon your plan and follow the surprise. The plan is a
  safety net, not a script. A surprise is worth more than a covered beat.
- If they mention a person, a fight, a near-failure, or a specific dollar amount,
  that is the story. Go there.
- If they contradict themselves or dodge, ask once more, gently and directly. ONCE.
  If they dodge the same thing twice, they are telling you no. Drop it and move on —
  never rephrase the same question a third time. Whatever they are protecting is not
  worth the rest of the interview.

HOW YOU FINISH:
- Around the last minute, land the plane. Ask the closer:
  "What should I have asked you that I didn't?" It is the single best question
  in interviewing and it almost always produces the pull quote.
- Then thank them by name and stop. Do not keep going.
`.trim();

/**
 * Language rules. Spanish here is neutral Latin American — "tú", never "vos",
 * no Iberian "vosotros", no regional slang. The people being interviewed are
 * business owners, not a particular country's internet.
 */
export function languageRule(language?: Language): string {
  if (language !== "es") return "";
  return `

LANGUAGE — THIS IS NOT OPTIONAL
Everything you say is in Spanish. Neutral Latin American Spanish: use "tú", never
"vos" and never "vosotros". No slang tied to one country, no Iberian vocabulary.
Speak the way a warm, plain-spoken journalist from Latin America speaks out loud —
short sentences, ordinary words, no formality that would make someone feel
interviewed by a bank. Every rule of craft above still applies, in Spanish.`;
}

const MOVES: InterviewMove[] = [
  "open",
  "follow_up",
  "press_for_detail",
  "next_beat",
  "mirror",
  "close",
];

const NEXT_QUESTION_TOOL = {
  name: "ask",
  description: "Say the next thing to the person you are interviewing.",
  input_schema: {
    type: "object" as const,
    properties: {
      question: {
        type: "string",
        description:
          "Exactly what you say out loud next. One question. Short. Spoken English, contractions fine.",
      },
      move: {
        type: "string",
        enum: MOVES,
        description:
          "open = first question. follow_up = chasing what they just said. press_for_detail = their answer was thin, get the example. mirror = repeat their own words back as a question. next_beat = moving to a new required beat. close = landing the plane.",
      },
      reasoning: {
        type: "string",
        description:
          "One short sentence: why this question, right now. Shown live to the editor.",
      },
      topic: {
        type: "string",
        description:
          "One to three lowercase words naming WHAT this question is about, e.g. 'the crying customer', 'first day', 'the name'. Use the SAME label when you are still asking about the same thing, even if you reword the question. This is how we detect circling, so be honest.",
      },
      beats_now_covered: {
        type: "array",
        items: { type: "string" },
        description:
          "Beats from the assignment that the transcript now covers well enough to stop asking about. Exact strings from the beat list.",
      },
      should_end: {
        type: "boolean",
        description:
          "True only after you have delivered the closing question and heard the answer.",
      },
    },
    required: ["question", "move", "reasoning", "topic", "beats_now_covered", "should_end"],
  },
};

export interface NextQuestion {
  question: string;
  move: InterviewMove;
  reasoning: string;
  topic: string;
  beats_now_covered: string[];
  should_end: boolean;
}

const STOPWORDS = new Set([
  "what", "when", "where", "that", "this", "they", "them", "then", "than", "with",
  "your", "you're", "about", "would", "could", "should", "there", "were", "was",
  "did", "does", "have", "has", "how", "the", "and", "but", "for", "you", "say",
  "said", "tell", "like", "just", "know", "think", "back", "from", "into",
]);

/** Literal-repeat backstop for when the model mislabels its own topic. */
function wordsOverlap(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z\s']/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !STOPWORDS.has(w)),
    );
  const wa = words(a);
  const wb = words(b);
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared >= 2;
}

/** Turns from the phase we're currently in. Intake chatter is not the interview. */
export function turnsInPhase(interview: Interview): Turn[] {
  const phase = interview.phase ?? "interview";
  return interview.turns.filter((t) => (t.phase ?? "interview") === phase);
}

function transcriptFor(interview: Interview): string {
  const turns = turnsInPhase(interview);
  if (turns.length === 0) return "(nothing yet — this is your first question)";
  return turns
    .map((t: Turn) => `${t.speaker === "interviewer" ? "YOU" : "THEM"}: ${t.text}`)
    .join("\n");
}

function elapsedMinutes(interview: Interview): number {
  if (!interview.startedAt) return 0;
  return (Date.now() - interview.startedAt) / 60000;
}

export async function nextQuestion(
  assignment: Assignment,
  interview: Interview,
): Promise<NextQuestion> {
  const elapsed = elapsedMinutes(interview);
  const total = assignment.durationMinutes;
  const remaining = Math.max(0, total - elapsed);
  const uncovered = assignment.beats.filter((b) => !interview.beatsCovered[b]);

  const asked = turnsInPhase(interview).filter((t) => t.speaker === "interviewer");

  // An interview also ends because you've asked enough, not only because the
  // clock ran out. A fast talker can burn fifteen exchanges in six minutes.
  // An explicit maxQuestions wins outright — if someone said "five questions,
  // I'm working", five is a promise, not a suggestion.
  const turnBudget = assignment.maxQuestions
    ? Math.max(2, assignment.maxQuestions)
    : Math.max(6, Math.round(total * 1.4));
  const turnsLeft = turnBudget - asked.length;

  // The failure mode that kills the demo: asking the same question a third
  // time. Real journalists press once, then let it go. A subject who has
  // dodged twice is not going to give it to you on the third ask — they are
  // going to shut down, and you lose everything after that point.
  //
  // Do NOT key this off the `move` label: the model will happily relabel three
  // identical presses as three "follow_up"s and sail straight past the guard.
  // Two independent signals instead — the topic it declared, and the actual
  // words it used.
  const recent = asked.slice(-2);
  const sameTopic =
    recent.length === 2 &&
    Boolean(recent[0].topic) &&
    recent[0].topic!.toLowerCase().trim() === recent[1].topic?.toLowerCase().trim();
  const circling = sameTopic || wordsOverlap(recent[0]?.text, recent[1]?.text);
  const stuckOn = recent[1]?.topic ?? "that";

  let clock: string;
  if (assignment.maxQuestions && turnsLeft <= 0) {
    clock =
      `You have used all ${assignment.maxQuestions} questions you were given. ` +
      "Thank them by name and set should_end to true. Do not ask anything else.";
  } else if (remaining <= 1.25 || turnsLeft <= 1) {
    clock =
      "TIME TO LAND THE PLANE. Ask the closer now if you have not: " +
      '"What should I have asked you that I didn\'t?" If you already asked it and they answered, set should_end to true.';
  } else if ((remaining <= total * 0.35 || turnsLeft <= 3) && uncovered.length > 1) {
    clock = `About ${remaining.toFixed(1)} minutes and ${turnsLeft} questions left, with ${
      uncovered.length
    } beats still uncovered. Start moving. Pick the most important one.`;
  } else {
    clock = `About ${remaining.toFixed(
      1,
    )} of ${total} minutes left, roughly ${turnsLeft} questions. You have room to follow a good thread.`;
  }

  if (circling) {
    clock +=
      `\n\nSTOP — your last two questions were both about "${stuckOn}" and they dodged both times. ` +
      "They are not going to give it to you, and a third ask will make them shut down. " +
      `Do not mention ${stuckOn} again. Pick up a different thread — something else they said ` +
      "earlier, or an uncovered beat. Changing the wording is not changing the subject.";
  }

  const system = `${CRAFT}${languageRule(assignment.language)}

THIS ASSIGNMENT
You are interviewing ${assignment.subjectName}${
    assignment.subjectRole ? `, ${assignment.subjectRole}` : ""
  } about ${assignment.company || "their work — they did not name a company, so find out what they actually do before you go deep"}.
The editor's angle: ${assignment.angle}
${assignment.backgroundNotes ? `What you know going in: ${assignment.backgroundNotes}` : ""}

BEATS YOU MUST LAND (the editor needs these on the record):
${assignment.beats.map((b) => `- [${interview.beatsCovered[b] ? "covered" : "open"}] ${b}`).join("\n")}

CLOCK: ${clock}`;

  // Put its own recent questions and topic labels in front of it. Self-labelling
  // is unreliable in the same breath as generating — the model will happily call
  // three passes at the same subject three different things. Showing the actual
  // text, and the labels it is allowed to reuse, is what makes the guard bite.
  const lastThree = asked.slice(-3);
  const priorTopics = [...new Set(asked.map((t) => t.topic).filter(Boolean))];
  const memo = lastThree.length
    ? `YOUR LAST ${lastThree.length} QUESTION${lastThree.length === 1 ? "" : "S"}, VERBATIM:
${lastThree.map((t) => `  - "${t.text}"  [topic: ${t.topic ?? "?"}]`).join("\n")}

Do not ask another variation of any of these. Rewording is not a new question.
Topics you have already used — reuse the exact label if you are still on that
subject, do not invent a new name for it: ${priorTopics.join(", ") || "(none)"}

`
    : "";

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 400,
    system,
    tools: [NEXT_QUESTION_TOOL],
    tool_choice: { type: "tool", name: "ask" },
    messages: [
      {
        role: "user",
        content: `${memo}Transcript so far:\n\n${transcriptFor(
          interview,
        )}\n\nSay the next thing.`,
      },
    ],
  });

  const out = toolResult<NextQuestion>(msg);
  if (!out) {
    // Never leave a human sitting in silence. Fall back to the best generic move.
    return {
      question: "Can you give me an example of that?",
      move: "press_for_detail",
      reasoning: "Fallback — the model did not return a structured question.",
      topic: "fallback",
      beats_now_covered: [],
      should_end: false,
    };
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Intake — the form, asked out loud                                    */
/* ------------------------------------------------------------------ */

/**
 * Nobody standing at a food stall wants to fill in a form. So the interviewer
 * asks. Keep it to two or three questions: get a name, get what they do, and
 * get out. The real interview is where the value is — intake is the handshake,
 * not the conversation.
 */
const INTAKE = `
You are a warm, quick interviewer meeting someone for the first time. Before you
interview them you need three things, and you get them by asking, not by making
them type.

WHAT YOU NEED:
1. Their name (first name is enough).
2. What they do — their business, their work, whatever they'd say if a stranger asked.
3. Optionally, what they'd want people to understand about it. If they don't have an
   answer ready, do not push. It is genuinely optional.

HOW:
- One question at a time. Short and friendly. Under fifteen words.
- Take everything they give you at once. "I'm Ana, I run Ana's Flowers on Market"
  gives you name AND business — do not then ask what their business is.
- Do not interrogate. This is a handshake. Two questions is great, three is the limit.
- Never ask for an email, a phone number, or anything you do not need.
- The moment you have a name and some idea of what they do, set done to true and
  make your last line a warm handoff: tell them you're going to start, and what
  you'll be asking about.
- If they give a name and nothing else and seem in a hurry, that is enough. Set done.
`.trim();

const INTAKE_TOOL = {
  name: "intake",
  description: "Ask the next intake question, and record anything they just told you.",
  input_schema: {
    type: "object" as const,
    properties: {
      question: {
        type: "string",
        description:
          "What you say out loud next. If done is true, this is your handoff line into the interview.",
      },
      collected: {
        type: "object",
        description: "Everything you now know. Include fields learned in earlier turns too.",
        properties: {
          subjectName: { type: "string", description: "Their name as they gave it." },
          subjectRole: { type: "string", description: "Their role, if they said one." },
          company: { type: "string", description: "Business or organisation, if any." },
          angle: {
            type: "string",
            description:
              "One sentence on what they'd want understood, in your words. Omit if they didn't say.",
          },
        },
      },
      done: {
        type: "boolean",
        description: "True once you have a name and a rough sense of what they do.",
      },
      reasoning: { type: "string", description: "One short line, for the editor." },
    },
    required: ["question", "collected", "done", "reasoning"],
  },
};

export interface IntakeStep {
  question: string;
  collected: {
    subjectName?: string;
    subjectRole?: string;
    company?: string;
    angle?: string;
  };
  done: boolean;
  reasoning: string;
}

export async function intakeQuestion(
  interview: Interview,
  language?: Language,
): Promise<IntakeStep> {
  const asked = turnsInPhase(interview).filter((t) => t.speaker === "interviewer").length;
  const pressure =
    asked >= 3
      ? "\n\nYou have asked three times already. Take what you have and set done to true now."
      : "";

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: INTAKE + languageRule(language) + pressure,
    tools: [INTAKE_TOOL],
    tool_choice: { type: "tool", name: "intake" },
    messages: [
      {
        role: "user",
        content:
          interview.turns.length === 0
            ? "Nothing yet — open the conversation."
            : `So far:\n\n${transcriptFor(interview)}\n\nSay the next thing.`,
      },
    ],
  });

  const out = toolResult<IntakeStep>(msg);
  if (!out) {
    return {
      question:
        language === "es" ? "Antes de empezar, ¿cómo te llamas?" : "Before we start — what's your name?",
      collected: {},
      done: false,
      reasoning: "Fallback — no structured response.",
    };
  }
  return out;
}

/** The very first thing anyone hears in a self-serve session. */
export function intakeOpener(language?: Language): string {
  return language === "es"
    ? "Hola, gracias por darme unos minutos. Te voy a preguntar un par de cosas sobre ti y después entramos en materia."
    : "Hey — thanks for giving me a few minutes. I'm going to ask you a bit about yourself and then we'll get into it.";
}

/** Warm cold-open so the subject isn't hit with a hard question first. */
export function greeting(assignment: Assignment): string {
  const first = (assignment.subjectName || "").split(" ")[0];
  if (assignment.language === "es") {
    const sobre = assignment.company?.trim() || "lo que haces";
    return `Hola ${first}, gracias por esto. Te voy a preguntar sobre ${sobre} por unos ${assignment.durationMinutes} minutos. No hay respuestas malas — habla como le hablarías a un amigo. Cuando quieras.`;
  }
  const about = assignment.company?.trim() || "what you do";
  return `Hey ${first}, thanks for doing this. I'm going to ask you about ${about} for about ${assignment.durationMinutes} minutes. There are no wrong answers — just talk like you'd talk to a friend. Ready when you are.`;
}
