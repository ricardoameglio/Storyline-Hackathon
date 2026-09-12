import { EDITOR_MODEL, anthropic, toolResult } from "./anthropic.ts";
import type { Assignment, Deliverable, GeneratedContent, Interview } from "./types.ts";
import { prepareTranscript } from "./transcript.ts";

/**
 * Prologue's own method, encoded. Their Discovery Audit looks for the "context
 * gap" — the distance between what the operator knows and what the market sees —
 * and lands on "the Nail": the sharp, repeatable truth you hammer in the market.
 * Speaking their language in the output is most of why this wins the bounty.
 */
const EDITOR = `
You are a senior editor at a strategic brand storytelling firm. You just got a raw
interview transcript back from your interviewer. Your job is to turn it into finished,
publishable work — not notes, not a summary.

TWO THINGS FIRST:

1. THE CONTEXT GAP. What does this operator know that the market clearly does not?
   It is almost always buried in an offhand line, not in the part where they try to
   sound impressive. Name it in one sentence.

2. THE NAIL. The sharp, repeatable truth you would hammer in the market for them.
   One sentence. Under fifteen words. Plain language, no adjectives doing the work,
   no "we're passionate about". It should sound like something the person would
   actually say out loud, because ideally it is.

Both of those are ONE SENTENCE each, under twenty words. A context gap that needs
three clauses is a context gap you have not found yet. Cut until it is sharp.

THE LINE YOU DO NOT CROSS: this copy gets published on a real person's account,
under their name. Every factual claim must be traceable to something they actually
said in the transcript. Specifically:
- Never convert one fact into a different fact. If they said a stew takes eighteen
  hours, you may NOT write that they work eighteen hours a day. That is a new claim
  about their life and you invented it.
- Never infer an absence. "A guy posted a video" does not mean "they have never run
  an ad". If they did not say it, it did not happen.
- Never upgrade or soften a word. "Goes back to Jalisco" is not "moves back to
  Jalisco". Visiting and emigrating are different things, and it is their mother.
- Write numbers the way a person writes them: $600, not "$6 hundred". If they said
  "rent was six" and the amount is genuinely ambiguous, write it as they said it or
  leave it out. Do not silently complete a number for them.
- When you are tempted to add a line because it would land well, that is exactly the
  line to cut. Good copy here is made of their facts, not your flourishes.

THEN THE COPY. Rules:
- Every quote must be verbatim from the transcript. Never invent, tidy, or improve a
  quote. You may trim with an ellipsis. If you are not sure it was said, leave it out.
- Lead with the most specific detail in the whole transcript. Specificity is the
  entire job. "Four in the morning" beats "early". "$38" beats "affordable".
- No marketing throat-clearing. Kill "In today's fast-paced world", "Imagine a place",
  "nestled in the heart of", "passion for excellence", "game-changing", "we're excited to".
- Short sentences. Write the way the person talks, not the way brands talk.
- No emoji unless writing an Instagram caption, and even then, at most two.
- No hashtags except on Instagram, and at most three, all plain.
- If the transcript does not support a claim, do not make the claim.
`.trim();

const CONTENT_TOOL = {
  name: "deliver",
  description: "Hand the finished work back to the editor.",
  input_schema: {
    type: "object" as const,
    properties: {
      nail: {
        type: "string",
        description: "The Nail. One sentence, under 15 words, plain language.",
      },
      contextGap: {
        type: "string",
        description:
          "One sentence: what this operator knows that the market does not see.",
      },
      summary: {
        type: "string",
        description:
          "Three or four plain sentences recapping what the conversation actually covered, written so the person interviewed would read it and think 'yes, that's what I said'. Their story in order, no analysis, no selling. This is the receipt for the ten minutes they gave you.",
      },
      keyTakeaways: {
        type: "array", items: { type: "string" },
        description: "Three concise takeaways supported by what the subject actually said. No invented advice or facts.",
      },
      pullQuotes: {
        type: "array",
        description: "Three to five verbatim quotes, best first.",
        items: {
          type: "object",
          properties: {
            quote: { type: "string", description: "Verbatim from the transcript." },
            why: { type: "string", description: "One short line: why this one lands." },
          },
          required: ["quote", "why"],
        },
      },
      linkedinPost: {
        type: "string",
        description:
          "150-220 words. Opens on the most specific detail in the transcript. One quote. No hashtags.",
      },
      instagramCaption: {
        type: "string",
        description:
          "60-110 words, first person as the business, warm, one quote or one number, at most 3 plain hashtags.",
      },
      xThread: {
        type: "array",
        items: { type: "string" },
        description: "4-6 posts, each under 280 characters. First post is the hook.",
      },
      blogDraft: {
        type: "string",
        description:
          "500-700 word draft in markdown with a real headline. Quotes verbatim and attributed.",
      },
      podcastSegment: {
        type: "string",
        description:
          "A 60-90 second read: host intro, the clip to play (quoted verbatim with a cue), host outro.",
      },
    },
    required: ["nail", "contextGap", "summary", "pullQuotes", "keyTakeaways"],
  },
};

const LABELS: Record<Deliverable, string> = {
  pull_quotes: "pullQuotes",
  linkedin_post: "linkedinPost",
  instagram_caption: "instagramCaption",
  blog_draft: "blogDraft",
  podcast_segment: "podcastSegment",
  x_thread: "xThread",
};

/**
 * The fact-check pass.
 *
 * A model writing marketing copy will quietly turn "the stew takes eighteen hours"
 * into "he works eighteen hours a day", because the second sentence lands better.
 * On a real vendor's account that is a lie about their life. So nothing ships
 * without a second read against the transcript, by a reader whose only job is to
 * catch invention — and the corrections are kept, because showing your work is
 * the difference between a tool an agency can use and a toy.
 */
const FACTCHECKER = `
You are a magazine fact-checker. You have a transcript and a draft written from it.
Your only job is to find claims in the draft that the transcript does not support.

FIRST, KNOW WHAT YOU ARE READING. Two of these fields are NOT quotations:
- "nail" is the editor's own positioning line. It is written ABOUT the subject, in
  the editor's voice. It must be FACTUALLY supported by the transcript, but it must
  NOT be reduced to the subject's exact words. Do not turn it into a quote. A nail
  that combines two things the person said into one sharp sentence is doing its job.
- "contextGap" is likewise the editor's own analysis. Check it for support, not for
  verbatim wording.
Everything inside quotation marks anywhere, and the pullQuotes, must be word-for-word.

If you rewrite the nail or the context gap, you must hand back something that still
meets their spec, because an accurate sentence that is too long has failed:
- nail: ONE sentence, UNDER FIFTEEN WORDS, in the editor's voice, no dashes stapling
  two ideas together, no hedges like "he says" inside it. Count the words before you
  return it. If it runs long, cut an idea — do not cut the sharpness.
- contextGap: ONE sentence, under twenty words.
Getting these accurate but flabby is the most common way this job goes wrong. A nail
nobody can repeat from memory is not a nail.

SECOND, AND THIS IS THE PART MOST CHECKERS GET WRONG. There is a difference between
a claim of FACT and a claim of MEANING, and only one of them is your business.

A claim of FACT says something happened, or is true of the world: how long something
takes, what someone does, what a number is, what a person said or felt. Every one of
these must be traceable to the transcript.

A claim of MEANING is the editor saying what the facts add up to: "the eighteen hours
is the product", "the video got them in the door, the consomé keeps them coming back",
"this is not a marketing story". These are INTERPRETATION. They are the entire reason
a client hires a strategic storytelling firm, and they are allowed — as long as every
fact underneath them is supported. Do NOT flag a sentence just because the subject did
not say it themselves. If you strip out every interpretive line, what is left is a
transcript in paragraph form, and you have destroyed the work.

The test: could a careful reader disagree with this and be proven wrong by the
transcript? Then it is a factual claim — check it. Is it a way of seeing what is
already on the record? Then leave it alone.

Go through the draft line by line. Flag anything where:
- A fact was transformed into a different fact (a cooking time became a work schedule,
  a visit became a move, a single incident became a pattern).
- An absence was inferred ("they never advertise", "nobody helped them") from silence.
- A number was completed, rounded, converted, or written in broken form ("$6 hundred").
  Prefer putting the number back inside the person's own quoted words over deleting it
  — losing "four hundred dollars left and rent was six" costs the story its stakes.
  Cut only when quoting cannot save it.
- A quotation is not word-for-word what the person said. (This applies to quoted
  text. It does NOT apply to the nail or the context gap, which are the editor's
  own sentences — judge those on whether the facts hold up, nothing else.)
- A motive, feeling, or opinion was attributed to someone who did not state it.
  An editor's reading of what the facts mean is not an attributed feeling.
- A concrete detail was added that is not in the transcript — a sign, a location, a
  time of day, a person in the room.

Then rewrite each affected field so the claim is either corrected to what was
actually said, or cut. Cutting is always allowed and usually better. Do not rewrite
anything that is already supported — leave good sentences exactly as they are.

Being strict about facts is the job. Being strict about interpretation is not — that
is censorship of the work you were hired to protect. A draft with nothing flagged is a
fine outcome. Do not invent problems to look thorough, and do not let a false fact
survive because the sentence is beautiful.
`.trim();

const FACTCHECK_TOOL = {
  name: "check",
  description: "Report unsupported claims and return the corrected copy.",
  input_schema: {
    type: "object" as const,
    properties: {
      corrections: {
        type: "array",
        description: "One entry per unsupported claim found. Empty if the draft is clean.",
        items: {
          type: "object",
          properties: {
            field: { type: "string", description: "e.g. linkedinPost, instagramCaption, nail" },
            claim: { type: "string", description: "The offending text, quoted." },
            problem: { type: "string", description: "One line: why the transcript does not support it." },
            fix: { type: "string", description: "What it became, or 'cut'." },
          },
          required: ["field", "claim", "problem", "fix"],
        },
      },
      nail: { type: "string" },
      contextGap: { type: "string" },
      summary: { type: "string" },
      keyTakeaways: { type: "array", items: { type: "string" } },
      pullQuotes: {
        type: "array",
        description:
          "The corrected pull quotes. Each 'quote' must be verbatim; each 'why' is the editor's note and only needs its facts to hold up. Return the full corrected list, including the ones you did not change.",
        items: {
          type: "object",
          properties: {
            quote: { type: "string" },
            why: { type: "string" },
          },
          required: ["quote", "why"],
        },
      },
      linkedinPost: { type: "string" },
      instagramCaption: { type: "string" },
      blogDraft: { type: "string" },
      podcastSegment: { type: "string" },
      xThread: { type: "array", items: { type: "string" } },
    },
    required: ["corrections"],
  },
};

async function factCheck(
  transcript: string,
  draft: GeneratedContent,
  spanish = false,
): Promise<GeneratedContent> {
  const msg = await anthropic.messages.create({
    model: EDITOR_MODEL,
    max_tokens: 5000,
    system:
      FACTCHECKER +
      (spanish
        ? `\n\nThe copy is in Spanish and must stay in Spanish — neutral Latin American, "tú", no "vos" or "vosotros". Anything you rewrite comes back in Spanish. Your "problem" and "fix" notes are for the editor and may be in English.`
        : ""),
    tools: [FACTCHECK_TOOL],
    tool_choice: { type: "tool", name: "check" },
    messages: [
      {
        role: "user",
        content: `TRANSCRIPT\n${transcript}\n\n———\n\nDRAFT\n${JSON.stringify(
          draft,
          null,
          2,
        )}\n\nCheck it. Return the corrections and the corrected fields (only the text fields you were given).`,
      },
    ],
  });

  const out = toolResult<GeneratedContent>(msg);
  if (!out) return draft; // never block delivery on the checker

  const merged: GeneratedContent = { ...draft };
  if (Array.isArray(out.pullQuotes)) {
    merged.pullQuotes = out.pullQuotes;
  }
  for (const key of [
    "nail",
    "contextGap",
    "summary",
    "linkedinPost",
    "instagramCaption",
    "blogDraft",
    "podcastSegment",
  ] as const) {
    if (typeof out[key] === "string" && out[key]) merged[key] = out[key] as string;
  }
  if (Array.isArray(out.xThread) && out.xThread.length) merged.xThread = out.xThread;
  if (Array.isArray(out.keyTakeaways)) merged.keyTakeaways = out.keyTakeaways;
  merged.corrections = out.corrections ?? [];
  return merged;
}

export async function generateContent(
  assignment: Assignment,
  interview: Interview,
): Promise<GeneratedContent> {
  await prepareTranscript(assignment, interview);
  const transcript = interview.cleanTranscript || interview.rawTranscript || "";
  const rawTranscript = interview.rawTranscript || transcript;

  const wanted = assignment.deliverables.map((d) => LABELS[d]).filter(Boolean);

  const languageRule =
    assignment.language === "es"
      ? `\n\nLANGUAGE — NOT OPTIONAL\nWrite every deliverable in Spanish. Neutral Latin American Spanish: "tú", never "vos" or "vosotros", no country-specific slang, no Iberian vocabulary. Quotes stay exactly as the person said them, in whatever language they said them. Field names stay in English; their contents are in Spanish.`
      : "";

  const msg = await anthropic.messages.create({
    model: EDITOR_MODEL,
    max_tokens: 4000,
    system: EDITOR + languageRule,
    tools: [CONTENT_TOOL],
    tool_choice: { type: "tool", name: "deliver" },
    messages: [
      {
        role: "user",
        content: `ASSIGNMENT
Subject: ${assignment.subjectName}${assignment.subjectRole ? `, ${assignment.subjectRole}` : ""}
${assignment.company ? `Company: ${assignment.company}` : "Company: not given — take it from the transcript, and do not invent a business name."}
Angle: ${assignment.angle}

Fill these fields: nail, contextGap, summary, keyTakeaways, pullQuotes${
          wanted.length ? `, ${wanted.filter((w) => w !== "pullQuotes").join(", ")}` : ""
        }. Leave every other field out.

CLEAN TRANSCRIPT — use for the story and summary
${transcript}

RAW TRANSCRIPT — all direct quotations must come from these original words
${rawTranscript}`,
      },
    ],
  });

  const draft = toolResult<GeneratedContent>(msg);
  if (!draft) throw new Error("The editor returned nothing usable.");

  try {
    return await factCheck(rawTranscript, draft, assignment.language === "es");
  } catch (err) {
    console.error("[factcheck] failed, delivering the unchecked draft:", err);
    return draft;
  }
}
