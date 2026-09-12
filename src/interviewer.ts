import { MODEL, anthropic, toolResult } from "./anthropic.ts";
import type { Assignment, Interview, InterviewMove, InterviewType, Language, Turn } from "./types.ts";
import { interviewStyle } from "./interview-styles.ts";

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
form. Work within the configured duration and find one great story.

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

CHECK THE PREMISE BEFORE YOU ASK. This is where interviews go stupid:
- Every question assumes something. Before you ask, test that assumption against
  what they have ALREADY told you. If the assumption is dead, the question is dead.
- They said the business opened today? Then there is no "hardest day so far", no
  "how has it changed", no "what have you learned over the years". Ask about today:
  what happened this morning, why today, what they were doing yesterday instead.
- They are a student, not an owner? Then there are no customers, no revenue, no
  team. Ask about the work itself, the class, the project, the thing they are
  building, the person who got them into it.
- They have been open three weeks? "The hardest day" is fine. "How has the
  neighbourhood changed since you opened" is not.
- An answer that kills a question is a gift, not an obstacle. It just told you
  where the real story is. Go there instead.

NEVER ASK WHAT THEY ALREADY ANSWERED:
- Before every question, read back over the transcript. If the answer is already in
  there, you are not listening, and they will notice immediately.
- This includes answers buried inside another answer. If they said "the first friend
  I met studies mechanical engineering", do NOT then ask what that friend studies.
  They told you. Ask what you don't know: who the friend is, how they met, whether
  that pushed them the other way.
- And never re-ask your own question in new words, however many turns have passed.
  "What do you wish people understood about home?" and "What don't people understand
  about home that you wish they did?" are the same question. Asking it twice tells
  them you weren't paying attention the first time.
- The full list of what you have already asked is in front of you. Use it.

NEVER ASK A QUESTION THAT HAS NO ANSWER:
- Do not ask someone to summarize their own meaning. "What do you want people to
  think about that?", "What does that say about you?", "What's the takeaway?" —
  that is the editor's job, not theirs. Nobody has an answer ready, so they either
  freeze or hand you a slogan. Both are useless.
- Do not ask them to speak for other people's opinions in the abstract. "How do
  people see your industry?" is a survey question, not an interview question.
- Ask what happened. Finding the meaning in their facts is your job, afterwards.

HOW YOU LISTEN:
- If their answer is short, flat, or abstract, do NOT move on. Ask for the example.
  "Can you give me an example?" / "When did that happen?" / "Walk me through it."
- If they say something loaded, mirror it. Repeat their own two or three words back
  as a question. "Twenty hours?" People fill silence with the good stuff.
- If they surprise you, abandon your plan and follow the surprise. The plan is a
  safety net, not a script. A surprise is worth more than a covered beat.
- If they mention a person, a fight, a near-failure, or a specific dollar amount,
  that is the story. Go there.
- If they OFFER you something — "do you want to know the brands?" — answer the offer
  out loud before you move. Walking past it teaches them to stop offering.
- If they contradict themselves or dodge, ask once more, gently and directly. ONCE.
  If they dodge the same thing twice, they are telling you no. Drop it and move on —
  never rephrase the same question a third time. Whatever they are protecting is not
  worth the rest of the interview.

HOW YOU FINISH:
- Around the last minute, invite one final reflection or anything left unsaid.
  Vary the wording naturally and connect it to the conversation. Do not open a new topic.
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
      bridge: {
        type: "string",
        description:
          "Optional. A short spoken clause, under eight words, said just BEFORE the question when you are turning to a new subject: \"Okay, different thing.\" / \"Before we leave the mansion —\" / \"Let me go back to something.\" Leave it empty when you are following the thread they just opened; a follow-up needs no signpost. It is a turn signal, never praise — \"that's great\" is still banned. Write the question exactly as you would have written it anyway; this field is separate and does not change it.",
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
      beats_to_drop: {
        type: "array",
        items: { type: "string" },
        description:
          "Beats whose premise this person just killed — a business that opened today has no hardest year, a student has no customers. Exact strings from the beat list. Dropped beats are never asked again.",
      },
      beats_to_add: {
        type: "array",
        items: { type: "string" },
        description:
          "New beats YOU write for this specific person, in the same style as the list: a concrete thing worth getting on the record, not a question. Add one whenever you drop one, and whenever they open a door worth walking through. This is how a generic brief becomes their interview.",
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
  /** Optional turn signal spoken before the question. */
  bridge?: string;
  move: InterviewMove;
  reasoning: string;
  topic: string;
  beats_now_covered: string[];
  beats_to_drop?: string[];
  beats_to_add?: string[];
  should_end: boolean;
}

const STOPWORDS = new Set([
  "what", "when", "where", "that", "this", "they", "them", "then", "than", "with",
  "your", "you're", "about", "would", "could", "should", "there", "were", "was",
  "did", "does", "have", "has", "how", "the", "and", "but", "for", "you", "say",
  "said", "tell", "like", "just", "know", "think", "back", "from", "into",
]);

/**
 * Has it already asked this, in any wording, at any point?
 *
 * The prompt gets the full list and is told not to repeat, but "what do you wish
 * people understood about Congo" and "what don't people understand about Congo
 * that you wish they did" came seven turns apart and it did not notice. Words on
 * the page are cheaper to trust than the model's memory of its own behaviour.
 */
export function alreadyAsked(candidate: string, previous: string[]): string | null {
  for (const q of previous) if (wordsOverlap(candidate, q)) return q;
  return null;
}

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
  opts: { banned?: string; mustContinue?: boolean } = {},
): Promise<NextQuestion> {
  const elapsed = elapsedMinutes(interview);
  const total = assignment.durationMinutes;
  const remaining = Math.max(0, total - elapsed);
  const uncovered = assignment.beats.filter(
    (b) => !interview.beatsCovered[b] && !interview.beatsDropped?.[b],
  );

  const asked = turnsInPhase(interview).filter((t) => t.speaker === "interviewer");

  // An interview also ends because you've asked enough, not only because the
  // clock ran out. A fast talker can burn fifteen exchanges in six minutes.
  // An explicit maxQuestions wins outright — if someone said "five questions,
  // I'm working", five is a promise, not a suggestion.
  const turnBudget = assignment.maxQuestions ? Math.max(2, assignment.maxQuestions) : Infinity;
  const turnsLeft = turnBudget - asked.length;
  const closingAnswered = Boolean(interview.closingQuestionAsked && interview.turns.at(-1)?.speaker === "subject");
  const closing = closingAnswered || turnsLeft <= 0 ? "thanks"
    : remaining <= 1 || turnsLeft <= 1 ? "question" : undefined;

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
  if (closing === "thanks") {
    clock = "CLOSING: They have finished their final answer. Thank them warmly, with no question, and set should_end to true. Set move to close. Stop here.";
  } else if (closing === "question") {
    clock =
      "CLOSING: Ask exactly one concise invitation to add anything important or reflect before wrapping up. " +
      "Vary the wording naturally, acknowledge the current thread, and do not introduce a new topic. Set move to close and should_end to false. Closing overrides all uncovered beats and follow-up rules.";
  } else if ((remaining <= total * 0.35 || turnsLeft <= 3) && uncovered.length > 1) {
    clock = `About ${remaining.toFixed(1)} minutes${Number.isFinite(turnsLeft) ? ` and ${turnsLeft} questions` : ""} left, with ${
      uncovered.length
    } beats still uncovered. Start moving. Pick the most important one.`;
  } else {
    clock = `About ${remaining.toFixed(
      1,
    )} of ${total} minutes left. ${Number.isFinite(turnsLeft) ? `${turnsLeft} question slots remain, including the final invitation.` : "There is no question limit."} You have room to follow a good thread.`;
  }

  if (opts.mustContinue && !closing) {
    clock =
      `DO NOT END. You have asked ${asked.length} question${asked.length === 1 ? "" : "s"} ` +
      `and this is meant to run about ${total} minutes. There is far more to get.\n` +
      "Pick up a thread you left behind — something they mentioned in passing, a person, " +
      "a place, a number, a decision — or write a beat that fits this person and start it. " +
      "Do not ask a wrap-up question and do not set should_end.";
  } else if (opts.banned && !closing) {
    clock +=
      `\n\nYOU JUST TRIED TO ASK THIS AGAIN: "${opts.banned}"\n` +
      "You already asked that and they already answered it. Rewording it does not make it " +
      "a new question. Ask about something genuinely new — a person, a place, a number or " +
      "a decision from the transcript you have not opened yet.";
  }

  if (circling && !closing) {
    clock +=
      `\n\nSTOP — your last two questions were both about "${stuckOn}" and they dodged both times. ` +
      "They are not going to give it to you, and a third ask will make them shut down. " +
      `Do not mention ${stuckOn} again. Pick up a different thread — something else they said ` +
      "earlier, or an uncovered beat. Changing the wording is not changing the subject.";
  }

  const system = `${CRAFT}${languageRule(assignment.language)}

YOUR BEATS ARE A GUESS — REWRITE THEM AS YOU GO
The beat list below was written before anyone knew who you would be talking to, and
it assumes a certain kind of person. If this person is not that, the beats are wrong,
and following a wrong beat is worse than skipping it. So do both halves of the job:
- DROP what does not fit (beats_to_drop). A shop that opened today has no hardest
  year; a student has no customers.
- REPLACE it (beats_to_add). Every time you drop one, write one that does fit this
  person. An engineering student has a project that ate their semester, a professor
  who changed their mind, the thing they build when nobody assigns it. A day-old
  business has this morning, the decision to open, what they quit to do it.
- ADD when they open a door. A person, a place, a fight, a number or a turning point
  you were not briefed on is a new beat. Write it down and come back to it.
Keep four or five open beats in front of you at all times. If the list is emptying
out you are not running out of interview — you are failing to write the one that
fits. Dropping every beat and going home is the worst outcome available.

THIS ASSIGNMENT
You are interviewing ${assignment.subjectName}${
    assignment.subjectRole ? `, ${assignment.subjectRole}` : ""
  } about ${assignment.company || (assignment.interviewType ? "their experiences and perspective; a company is not required" : "their work — they did not name a company, so find out what they actually do before you go deep")}.
${assignment.interviewType ? `INTERVIEW LENS: ${interviewStyle(assignment.interviewType, assignment.language).angle} Follow their answers dynamically; this is a lens, not a script. For personal stories, do not require a business or professional framing.` : ""}
The editor's angle: ${assignment.angle}
${assignment.backgroundNotes ? `What you know going in: ${assignment.backgroundNotes}` : ""}

${assignment.interviewType ? "POSSIBLE THREADS (follow interesting answers rather than treating these as a checklist)" : "BEATS YOU MUST LAND (the editor needs these on the record)"}:
${assignment.beats
  .filter((b) => !interview.beatsDropped?.[b])
  .map((b) => `- [${interview.beatsCovered[b] ? "covered" : "open"}] ${b}`)
  .join("\n") || "- (none of them fit this person — follow the conversation instead)"}

CLOCK: ${clock}`;

  // Put its own recent questions and topic labels in front of it. Self-labelling
  // is unreliable in the same breath as generating — the model will happily call
  // three passes at the same subject three different things. Showing the actual
  // text, and the labels it is allowed to reuse, is what makes the guard bite.
  const priorQuestions = asked;
  const priorTopics = [...new Set(asked.map((t) => t.topic).filter(Boolean))];
  const memo = priorQuestions.length
    ? `EVERY QUESTION YOU HAVE ALREADY ASKED, VERBATIM — do not ask any of these again,
in any wording:
${priorQuestions.map((t) => `  - "${t.text}"  [topic: ${t.topic ?? "?"}]`).join("\n")}

Do not ask another variation of any of these. Rewording is not a new question.
Topics you have already used — reuse the exact label if you are still on that
subject, do not invent a new name for it: ${priorTopics.join(", ") || "(none)"}

`
    : "";

  let out: NextQuestion | undefined;
  try {
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

    out = toolResult<NextQuestion>(msg) ?? undefined;
  } catch (error) {
    if (!closing) throw error;
  }
  const fallbackClose = (thanks: boolean): NextQuestion => ({
    question: assignment.language === "es"
      ? (thanks ? "Gracias por compartir tu historia y por tu tiempo." : "Antes de terminar, ¿hay algo importante que te gustaría agregar?")
      : (thanks ? "Thank you for sharing your story and taking the time." : "Before we wrap up, is there anything important you'd like to add?"),
    move: "close", reasoning: "Give the interview a warm, complete ending.", topic: "closing", beats_now_covered: [], should_end: thanks,
  });
  if (closing || out?.move === "close" || out?.should_end) {
    const thanks = closing === "thanks";
    if (!out || typeof out.question !== "string" || !out.question.trim() || out.move !== "close" || out.should_end !== thanks
      || (thanks ? /[?¿]/.test(out.question) : (out.question.match(/\?/g) ?? []).length !== 1)) out = fallbackClose(thanks);
    out = { ...out, move: "close", should_end: thanks, beats_now_covered: Array.isArray(out.beats_now_covered) ? out.beats_now_covered : [] };
    if (!thanks) interview.closingQuestionAsked = true;
    return out;
  }
  if (!out || typeof out.question !== "string" || !out.question.trim()) {
    // Never leave a human sitting in silence. Fall back to the best generic move.
    return {
      question: "Can you give me an example of that?",
      move: "press_for_detail",
      reasoning: "Fallback — the model did not return a structured question.",
      topic: "fallback",
      beats_now_covered: [],
      beats_to_drop: [],
      beats_to_add: [],
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
  interviewType?: InterviewType,
): Promise<IntakeStep> {
  const asked = turnsInPhase(interview).filter((t) => t.speaker === "interviewer").length;
  const pressure =
    asked >= 3
      ? "\n\nYou have asked three times already. Take what you have and set done to true now."
      : "";

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: INTAKE + languageRule(language) + pressure + (interviewType
      ? `\nSELECTED LENS: ${interviewStyle(interviewType, language).angle} Keep this direction in the handoff. ${interviewType === "personal" ? "For this personal conversation, collect their name and what experience they want to share instead of requiring their work or business. Their name alone is enough to begin." : ""}`
      : ""),
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

/* ------------------------------------------------------------------ */
/* Consent, asked out loud                                              */
/* ------------------------------------------------------------------ */

/** Spoken version of the visibility question. Buttons stay as a fallback. */
export function consentQuestion(language?: Language): string {
  return language === "es"
    ? "Una última cosa antes de terminar. ¿Prefieres que esta conversación quede privada, o te parece bien que aparezca en el archivo público? Cualquiera de las dos está bien."
    : "One last thing before we wrap up. Would you rather this conversation stayed private, or are you okay with it going on the record? Either is completely fine.";
}

export function consentThanks(onRecord: boolean, language?: Language): string {
  if (language === "es") {
    return onRecord
      ? "Perfecto, queda en el archivo público. Gracias por tu tiempo."
      : "Entendido, la dejo privada. Gracias por tu tiempo.";
  }
  return onRecord
    ? "Great — it'll go on the record. Thanks for your time."
    : "Understood, I'll keep it private. Thanks for your time.";
}

const CONSENT_TOOL = {
  name: "consent",
  description: "Decide whether they agreed to the interview appearing publicly.",
  input_schema: {
    type: "object" as const,
    properties: {
      onRecord: {
        type: "boolean",
        description:
          "True only if they clearly agreed to it being public. Hesitation, a question back, a condition, or anything ambiguous is false — consent is given, never assumed.",
      },
      certain: {
        type: "boolean",
        description: "False if the answer was ambiguous enough that they should be asked again.",
      },
    },
    required: ["onRecord", "certain"],
  },
};

/**
 * Yes or no, in either language, however they phrase it. The default on any
 * doubt is private: it is their story and their face, and an archive built on
 * maybes is worth less than a smaller one.
 */
export async function classifyConsent(
  text: string,
  language?: Language,
): Promise<{ onRecord: boolean; certain: boolean }> {
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 150,
      system:
        "Someone was just asked whether their interview can appear publicly, or should stay " +
        "private. Read their answer and decide whether they agreed to it being public. They " +
        "may answer in English or Spanish, casually or indirectly. Agreement must be clear. " +
        "If they hesitate, ask something back, set a condition, or say anything you are unsure " +
        "about, onRecord is false.",
      tools: [CONSENT_TOOL],
      tool_choice: { type: "tool", name: "consent" },
      messages: [{ role: "user", content: `They said: "${text}"` }],
    });
    const out = toolResult<{ onRecord: boolean; certain: boolean }>(msg);
    return out ?? { onRecord: false, certain: false };
  } catch {
    return { onRecord: false, certain: false };
  }
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
    const sobre = assignment.interviewType === "personal" ? "tu historia" : assignment.company?.trim() || "lo que haces";
    return `Hola ${first}, gracias por esto. Te voy a preguntar sobre ${sobre} por unos ${assignment.durationMinutes} minutos. No hay respuestas malas — habla como le hablarías a un amigo. Cuando quieras.`;
  }
  const about = assignment.interviewType === "personal" ? "your story" : assignment.company?.trim() || "what you do";
  return `Hey ${first}, thanks for doing this. I'm going to ask you about ${about} for about ${assignment.durationMinutes} minutes. There are no wrong answers — just talk like you'd talk to a friend. Ready when you are.`;
}
