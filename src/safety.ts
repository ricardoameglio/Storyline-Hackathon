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
- Deliberate derailment: they are not here to be interviewed, they are here to
  see what the system does.

DO NOT stop for:
- Ordinary swearing inside a real answer. "We were fucking broke", "it was a shit
  year", "that guy was an asshole to me" — this is how people talk about hard
  things, and cutting them off mid-story would be the worse mistake.
- Anger, grief, bluntness, or criticism of someone who wronged them.
- Blunt talk about a difficult subject when they are genuinely answering.
- Adult but non-sexual work, or a business you personally find distasteful. A
  legal business is a legal business.

The line: swearing while telling you something real is fine. Aiming sexual or
hateful content at a person, or wasting the interview on purpose, is not.

When in doubt about a real answer from someone genuinely talking, continue. When
in doubt about something aimed at the interviewer, stop.
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
          ? "\n\nSTRICT MODE: this archive is being shown publicly today. Also stop for sustained crude language even inside a real answer, and for anything you would not want on a screen behind a stage."
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
