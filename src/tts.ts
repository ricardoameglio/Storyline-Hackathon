import "dotenv/config";

const VOICE = process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL";

export const ttsEnabled = () => Boolean(process.env.ELEVENLABS_API_KEY);

/**
 * ElevenLabs streaming TTS. If there's no key, the route returns 204 and the
 * browser falls back to the built-in speech synthesis — the demo still runs.
 */
export async function speak(text: string): Promise<ArrayBuffer | null> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return null;

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/stream?optimize_streaming_latency=3`,
    {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.75,
          style: 0.35,
          use_speaker_boost: true,
        },
      }),
    },
  );

  if (!res.ok) {
    console.error("[tts] elevenlabs error", res.status, await res.text().catch(() => ""));
    return null;
  }
  return res.arrayBuffer();
}
