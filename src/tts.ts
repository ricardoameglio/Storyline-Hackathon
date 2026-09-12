import "dotenv/config";

const VOICE = process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL";

/**
 * A Spanish speaker deserves a voice that actually speaks Spanish. The
 * multilingual model will read Spanish with an English-trained voice, but the
 * rhythm gives it away instantly — and to a Panamanian vendor that reads as
 * "this thing wasn't built for me". Falls back to the main voice if unset.
 */
const VOICE_ES = process.env.ELEVENLABS_VOICE_ID_ES || VOICE;

const voiceFor = (language?: string) => (language === "es" ? VOICE_ES : VOICE);

/**
 * turbo models are fast and flat; the multilingual/expressive ones breathe more
 * but add latency. In a conversation the questions are short, so the extra
 * hundreds of milliseconds are usually worth sounding like a person.
 */
const TTS_MODEL = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";

/**
 * Lower stability = more variation in delivery, which is what makes a voice
 * sound human. Too low and it wobbles. 0.3 with style up is the sweet spot for
 * conversational reads.
 */
const num = (v: string | undefined, fallback: number) =>
  v === undefined || v === "" || Number.isNaN(Number(v)) ? fallback : Number(v);

/**
 * v3 is a different model, not a newer version of the same one, and it takes
 * different settings. It has no `style` and no `use_speaker_boost`, and its
 * stability is three discrete modes rather than a dial — Creative, Natural,
 * Robust. Send it the v2 numbers and you get a flat, faintly robotic read,
 * which is exactly what happens if you only change the model id.
 */
const isV3 = TTS_MODEL.startsWith("eleven_v3");

/** 0 Creative (most expressive), 0.5 Natural, 1 Robust. Nothing in between. */
const v3Stability = (v: number) => (v < 0.25 ? 0 : v < 0.75 ? 0.5 : 1);

const SETTINGS = isV3
  ? { stability: v3Stability(num(process.env.ELEVENLABS_STABILITY, 0.5)) }
  : {
      stability: num(process.env.ELEVENLABS_STABILITY, 0.3),
      similarity_boost: num(process.env.ELEVENLABS_SIMILARITY, 0.75),
      style: num(process.env.ELEVENLABS_STYLE, 0.55),
      use_speaker_boost: true,
    };

/**
 * Delivery cues like [laughs] only mean something to v3. Every other model
 * reads them out loud, word for word, which is worse than not having them.
 */
export const supportsAudioTags = () => isV3;

/**
 * A whitelist, not a pattern. Anything-in-brackets would also swallow a real
 * sentence — "he said [the thing nobody says] out loud" — and quietly delete a
 * subject's own words from their own transcript. Only these are cues.
 */
const CUES = [
  "laughs", "laughing", "chuckles", "giggles", "sighs", "exhales", "inhales",
  "breathes", "pauses", "whispers", "shouts", "excited", "curious", "sarcastic",
  "amused", "surprised", "warmly", "softly", "gently", "seriously",
];
const CUE_RE = new RegExp(`\\[\\s*(?:${CUES.join("|")})\\s*\\]`, "gi");

export const stripAudioTags = (text: string) =>
  String(text ?? "").replace(CUE_RE, "").replace(/\s{2,}/g, " ").trim();

export const ttsEnabled = () => Boolean(process.env.ELEVENLABS_API_KEY);

/**
 * Say out loud, at boot, exactly which voice and which models this account can
 * actually use. Paid tiers get models the docs don't make obvious, and picking
 * one by guessing is how you end up with an audiobook narrator asking someone
 * about their taco stall.
 */
export async function preflightTts() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    console.log("[tts] no ElevenLabs key — using the browser's built-in voice");
    return;
  }
  const headers = { "xi-api-key": key };

  for (const [label, vid] of [
    ["en", VOICE],
    ...(VOICE_ES !== VOICE ? ([["es", VOICE_ES]] as [string, string][]) : []),
  ] as [string, string][]) {
    try {
      const vr = await fetch(`https://api.elevenlabs.io/v1/voices/${vid}`, { headers });
      if (vr.ok) {
        const v: any = await vr.json();
        console.log(`[tts] voice (${label}): ${v.name ?? vid}${v.category ? ` — ${v.category}` : ""}`);
      } else {
        console.error(`[tts] voice ${vid} not reachable (${vr.status}). Check ELEVENLABS_VOICE_ID${label === "es" ? "_ES" : ""}.`);
      }
    } catch (err) {
      console.error("[tts] could not look up a voice:", (err as Error).message);
    }
  }
  if (VOICE_ES === VOICE) {
    console.log("[tts] no ELEVENLABS_VOICE_ID_ES set — Spanish will use the English voice");
  }

  try {
    const mr = await fetch("https://api.elevenlabs.io/v1/models", { headers });
    if (!mr.ok) {
      console.error(`[tts] could not list models (${mr.status}).`);
      return;
    }
    const models: any[] = await mr.json();
    const speakable = models.filter((m) => m.can_do_text_to_speech !== false);
    const ids = speakable.map((m) => m.model_id);
    console.log(`[tts] model: ${TTS_MODEL}${ids.includes(TTS_MODEL) ? "" : "  <-- NOT AVAILABLE"}`);
    console.log("[tts] available to this account:");
    for (const m of speakable) {
      console.log(`        ${m.model_id}${m.name ? `  — ${m.name}` : ""}`);
    }
    console.log("      Set ELEVENLABS_MODEL in .env to try another.");
  } catch (err) {
    console.error("[tts] could not list models:", (err as Error).message);
  }
}

/**
 * ElevenLabs streaming TTS. If there's no key, the route returns 204 and the
 * browser falls back to the built-in speech synthesis — the demo still runs.
 */
export async function speak(text: string, language?: string): Promise<ArrayBuffer | null> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return null;

  // v3 rejects the latency hint outright — and a rejected request is worse than
  // a slow one, because the browser quietly falls back to its own robot voice
  // and you spend an hour blaming the model settings.
  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceFor(language)}/stream` +
    (isV3 ? "" : "?optimize_streaming_latency=3");

  const res = await fetch(
    url,
    {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        // Tags reach the voice only when the voice understands them.
        text: isV3 ? text : stripAudioTags(text),
        model_id: TTS_MODEL,
        voice_settings: SETTINGS,
      }),
    },
  );

  if (!res.ok) {
    console.error("[tts] elevenlabs error", res.status, await res.text().catch(() => ""));
    return null;
  }
  return res.arrayBuffer();
}
