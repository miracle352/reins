// Speech to text for voice commands. Two ways:
// - GROQ_API_KEY set: Groq's hosted Whisper (free tier, fast, small memory). Used on the hosted server.
// - otherwise: Whisper running inside this server (transformers.js). Audio never leaves your machine,
//   but it needs ~400 MB of memory, so it suits self-hosting.
const GROQ = process.env.GROQ_API_KEY;
const MODEL = process.env.REINS_STT_MODEL ?? 'Xenova/whisper-base.en';
// Words Reins listens for; biases recognition toward them.
const HINT = 'Reins voice commands: approve, reject, why, kill it, pause, resume, yes, no, give one more, how much today.';

let asr: Promise<any> | undefined;
export async function warmVoice() {
  if (GROQ) return 'groq';
  if (process.env.REINS_VOICE === 'off') throw new Error('disabled');
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = process.env.REINS_MODEL_DIR ?? '.reins/models';
  asr ??= pipeline('automatic-speech-recognition', MODEL, { dtype: 'q8' });
  await asr; return 'local Whisper';
}

/** WAV container around raw PCM s16le mono 16 kHz. */
function wav(pcm: Buffer) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** PCM s16le mono 16 kHz (what G2 sends) -> text. */
export async function transcribe(pcmBase64: string): Promise<string> {
  const buf = Buffer.from(pcmBase64, 'base64');
  if (buf.length < 16000) return ''; // under 0.5 s: nothing said
  if (GROQ) {
    const form = new FormData();
    form.append('file', new Blob([wav(buf)], { type: 'audio/wav' }), 'clip.wav');
    form.append('model', process.env.GROQ_STT_MODEL ?? 'whisper-large-v3-turbo');
    form.append('language', 'en');
    form.append('prompt', HINT);
    form.append('response_format', 'json');
    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${GROQ}` }, body: form });
    const j: any = await r.json();
    if (!r.ok) throw new Error(j.error?.message ?? `speech service ${r.status}`);
    return String(j.text ?? '').trim();
  }
  if (!asr) await warmVoice();
  const pcm = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
  const out = await (await asr!)(Float32Array.from(pcm, s => s / 32768));
  return String(out.text ?? '').trim();
}
