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

const SETTINGS = {
  stability: num(process.env.ELEVENLABS_STABILITY, 0.3),
  similarity_boost: num(process.env.ELEVENLABS_SIMILARITY, 0.75),
  style: num(process.env.ELEVENLABS_STYLE, 0.55),
  use_speaker_boost: true,
};

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

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceFor(language)}/stream?optimize_streaming_latency=3`,
    {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
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
