/**
 * A radio recording made ready for speech-to-text: any file the browser can
 * decode (wav, mp3, m4a, ogg) becomes mono 16 kHz, cut into clips short enough
 * for the transcribe route's 2 MB limit, each a plain 16-bit WAV. Cuts are made
 * in the quietest moment near the clip length, which on a radio is the gap
 * between transmissions, so a sentence is not split down the middle.
 */

export const RADIO_RATE = 16_000;
/** Longest clip, in seconds: 20 s of 16-bit mono at 16 kHz is 640 kB. */
export const CLIP_S = 20;
/** How far back from the clip length a quiet moment is looked for. */
const SEARCH_S = 5;
const WINDOW_S = 0.2;

/** A 16-bit mono WAV file of these samples (-1..1). */
export function encodeWav(samples: Float32Array, rate = RADIO_RATE): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(out.buffer);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
  }
  return out;
}

/**
 * Where to cut: [start, end) sample ranges, each at most `clipS` long, ending
 * at the quietest 0.2 s within the last `SEARCH_S` seconds of its span.
 */
export function clipRanges(samples: Float32Array, rate = RADIO_RATE, clipS = CLIP_S): [number, number][] {
  const max = Math.floor(clipS * rate);
  const win = Math.max(1, Math.floor(WINDOW_S * rate));
  const ranges: [number, number][] = [];
  let start = 0;
  while (samples.length - start > max) {
    const from = start + max - Math.floor(SEARCH_S * rate);
    let best = start + max;
    let quietest = Infinity;
    for (let at = from; at + win <= start + max; at += win) {
      let energy = 0;
      for (let i = at; i < at + win; i++) energy += samples[i]! * samples[i]!;
      if (energy < quietest) {
        quietest = energy;
        best = at + Math.floor(win / 2);
      }
    }
    ranges.push([start, best]);
    start = best;
  }
  if (samples.length > start) ranges.push([start, samples.length]);
  return ranges;
}

/** True when a clip is all but silent, so it is not worth sending. */
export function isSilent(samples: Float32Array): boolean {
  let energy = 0;
  for (let i = 0; i < samples.length; i++) energy += samples[i]! * samples[i]!;
  return samples.length === 0 || Math.sqrt(energy / samples.length) < 0.004;
}

/** Decode a recording in the browser to mono 16 kHz samples. */
export async function decodeRecording(file: Blob): Promise<Float32Array> {
  const Ctx =
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx || typeof OfflineAudioContext === 'undefined') throw new Error('This browser cannot decode audio files.');
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * RADIO_RATE)), RADIO_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    return (await offline.startRendering()).getChannelData(0);
  } finally {
    void ctx.close();
  }
}

/** The recording as WAV clips ready to transcribe, silent ones left out. */
export async function recordingClips(file: Blob): Promise<Blob[]> {
  const samples = await decodeRecording(file);
  return clipRanges(samples)
    .map(([a, b]) => samples.subarray(a, b))
    .filter((clip) => !isSilent(clip))
    .map((clip) => new Blob([encodeWav(clip) as BlobPart], { type: 'audio/wav' }));
}
