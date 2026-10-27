import type { Config } from "./config.ts";
import { AppError } from "./domain.ts";
import { externalFetch } from "./http.ts";

export async function synthesizeSpeech(
  config: Config,
  text: string,
  signal?: AbortSignal,
) {
  if (config.APP_MODE !== "live" || !config.ELEVENLABS_API_KEY)
    throw new AppError(
      409,
      "speech_unavailable",
      "ElevenLabs voice is not configured",
    );
  const response = await externalFetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${config.ELEVENLABS_VOICE_ID}?output_format=mp3_44100_128`,
    {
      method: "POST",
      signal,
      headers: {
        "xi-api-key": config.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: config.ELEVENLABS_MODEL,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.75,
          style: 0,
          speed: 1,
          use_speaker_boost: false,
        },
      }),
    },
  );
  if (!response.ok || !response.headers.get("content-type")?.includes("audio/"))
    throw new AppError(
      502,
      "speech_failed",
      "Jolly’s voice is temporarily unavailable",
    );
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length || audio.length > 4 * 1024 * 1024)
    throw new AppError(
      502,
      "invalid_speech",
      "Jolly’s voice returned invalid audio",
    );
  return audio;
}
