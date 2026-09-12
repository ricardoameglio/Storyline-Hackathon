import { MODEL, anthropic, toolResult } from "./anthropic.ts";
import type { Language } from "./types.ts";

/**
 * Knowing when to end the interview.
 *
 * This is not a profanity filter. A vendor saying "we were broke as hell" is
 * good material and cutting them off would make the product worse. What ends an
 * interview is content that can never belong in a record with a real person's
 * name on it: a proposition aimed at the interviewer, a slur, a threat, someone
 * who is here to derail rather than talk.
 *
 * The test is not "was that rude". It is "could this ever be published".
 */
const SCREENER = `
You are deciding whether an interview should be stopped, based on what the person
being interviewed just said.

THEY MAY BE SPEAKING SPANISH. Every rule below applies identically in Spanish, and
the examples are in English only because that is the language this brief is written
in. Judge the meaning, not the language. Spanish equivalents of the stop cases are
stops: an explicit sexual description of what they do or who they are, a proposition
aimed at the interviewer, a slur, a threat. Spanish equivalents of the allowed cases
are allowed: ordinary swearing inside a real answer is how people talk about hard
things in every language, and cutting them off mid-story is the worse mistake.

STOP the interview if their message contains any of these:
- A sexual proposition, advance or explicit sexual content — especially anything
  directed at the interviewer.
- A slur, or hatred aimed at a group.
- A threat, or harassment of any kind.
- Sustained bad-faith derailment: several turns of refusing to engage at all,
  spamming nonsense, or trying to make the interviewer say something ugly. One
  odd answer is not this. Curiosity is not this. Testing whether you are a real
  person is not this.

DO NOT stop for:
- A QUESTION AIMED AT THE INTERVIEWER. "Can you answer my questions?", "Are you
  an AI?", "Who made you?", "What do you think?", "Is this being recorded?",
  "¿Tú puedes responderme?" — these are ordinary curiosity from someone talking
  to something new, and they are the single most common thing a real subject
  says. The interviewer knows how to decline or answer them. Stopping the
  interview over a polite question is the worst error you can make here, because
  the person did nothing wrong and will never understand why it ended.
- Someone asking what this is for, where it goes, or how long it takes.
- Small talk, jokes, a compliment, or a tangent.
- Ordinary swearing inside a real answer. "We were fucking broke", "it was a shit
  year", "that guy was an asshole to me" — this is how people talk about hard
  things, and cutting them off mid-story would be the worse mistake.
- Anger, grief, bluntness, or criticism of someone who wronged them.
- Blunt talk about a difficult subject when they are genuinely answering.
- Adult but non-sexual work, or a business you personally find distasteful. A
  legal business is a legal business.

The line: swearing while telling you something real is fine. Aiming sexual or
hateful content at a person, or wasting the interview on purpose, is not.

The test is never "was that off-topic" or "was that odd". It is: could this
sentence never be published next to this person's name? If you cannot name the
sexual content, the slur, the threat or the sustained abuse, the answer is no
and the interview continues.

When in doubt about anything at all, continue. Stopping a real interview is a
worse failure than letting one awkward sentence through — the write-up is
reviewed before anything is published, and the subject chooses privacy at the
end. Only stop when you can point at the specific thing.
`.trim();

const SCREEN_TOOL = {
  name: "screen",
  description: "Say whether this interview should keep going.",
  input_schema: {
    type: "object" as const,
    properties: {
      stop: { type: "boolean", description: "True only if the interview must end now." },
      reason: {
        type: "string",
        description:
          "Short internal note for the log, e.g. 'sexual proposition to interviewer'. Never shown to them.",
      },
    },
    required: ["stop", "reason"],
  },
};

export type Strictness = "off" | "normal" | "strict";

export const strictness = (): Strictness => {
  const v = (process.env.SAFETY ?? "normal").toLowerCase();
  return v === "off" || v === "strict" ? v : "normal";
};

export async function screenAnswer(text: string): Promise<{ stop: boolean; reason: string }> {
  const level = strictness();
  if (level === "off" || !text.trim()) return { stop: false, reason: "" };

  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 150,
      system:
        SCREENER +
        (level === "strict"
          ? "\n\nSTRICT MODE: this archive is being shown publicly today, so also stop for sustained crude language even inside a real answer. This raises the bar on CRUDE LANGUAGE only. It does not widen any other category, and it never makes a question, a tangent, a joke or an awkward answer into a reason to stop."
          : ""),
      tools: [SCREEN_TOOL],
      tool_choice: { type: "tool", name: "screen" },
      messages: [
        {
          role: "user",
          content: `They just said, in whatever language they speak: "${text}"`,
        },
      ],
    });
    return toolResult<{ stop: boolean; reason: string }>(msg) ?? { stop: false, reason: "" };
  } catch {
    // Never let the screener's failure end someone's real interview.
    return { stop: false, reason: "" };
  }
}

/** Neutral, no lecture. They know what they said; a sermon helps nobody. */
export function screenedGoodbye(language?: Language): string {
  return language === "es"
    ? "Voy a dejar la entrevista hasta aquí. Gracias por tu tiempo."
    : "I'm going to stop the interview here. Thanks for your time.";
}
