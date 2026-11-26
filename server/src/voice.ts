// Local speech-to-text with Whisper (transformers.js). Audio never leaves your Reins server.
import { pipeline, env } from '@huggingface/transformers';

env.cacheDir = process.env.REINS_MODEL_DIR ?? '.reins/models';
const MODEL = process.env.REINS_STT_MODEL ?? 'Xenova/whisper-base.en';

let asr: Promise<any> | undefined;
export const warmVoice = () => (asr ??= pipeline('automatic-speech-recognition', MODEL, { dtype: 'q8' }));

/** PCM s16le mono 16 kHz (what G2 and the phone mic send) -> text. */
export async function transcribe(pcmBase64: string): Promise<string> {
  const buf = Buffer.from(pcmBase64, 'base64');
  if (buf.length < 16000) return ''; // under 0.5 s: nothing said
  const pcm = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
  const audio = Float32Array.from(pcm, s => s / 32768);
  const model = await warmVoice();
  const out = await model(audio);
  return String(out.text ?? '').trim();
}
