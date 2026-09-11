import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";

/** Live interview turns. Latency matters — the subject is sitting in silence. */
export const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

/**
 * Writing and fact-checking the copy. Nobody is waiting on this, and it is what
 * the client actually reads, so spend the thinking here.
 */
export const EDITOR_MODEL = process.env.ANTHROPIC_EDITOR_MODEL || MODEL;

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Run once at boot. If the model id is wrong you find out now, not while a
 * vendor is standing in front of you with a microphone.
 */
export async function preflight() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("\n[preflight] ANTHROPIC_API_KEY is not set. Copy .env.example to .env.\n");
    return;
  }
  try {
    const models = await anthropic.models.list({ limit: 20 });
    const ids = models.data.map((m) => m.id);
    if (!ids.includes(MODEL)) {
      console.error(
        `\n[preflight] Model "${MODEL}" is not in your account's list.\n` +
          `            Available: ${ids.join(", ")}\n` +
          `            Set ANTHROPIC_MODEL in .env to one of those.\n`,
      );
    } else {
      console.log(`[preflight] model ok: ${MODEL}`);
    }
  } catch (err) {
    console.error("[preflight] could not reach the Anthropic API:", (err as Error).message);
  }
}

/** Pull the first tool_use block out of a response, typed loosely. */
export function toolResult<T>(msg: Anthropic.Message): T | null {
  for (const block of msg.content) {
    if (block.type === "tool_use") return block.input as T;
  }
  return null;
}
