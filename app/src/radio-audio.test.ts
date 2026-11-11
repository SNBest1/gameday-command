import { describe, expect, it } from 'vitest';
import { clipRanges, encodeWav, isSilent } from './radio-audio.ts';

const tone = (seconds: number, rate = 1000) =>
  Float32Array.from({ length: seconds * rate }, (_, i) => Math.sin(i / 3) * 0.5);

describe('radio recordings', () => {
  it('writes a 16-bit mono WAV', () => {
    const wav = encodeWav(Float32Array.from([0, 1, -1, 0.5]), 16000);
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...wav.slice(8, 16))).toBe('WAVEfmt ');
    expect(wav.length).toBe(44 + 8);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect([44, 46, 48, 50].map((at) => view.getInt16(at, true))).toEqual([0, 32767, -32768, 16384]);
  });

  it('leaves a short recording whole', () => {
    expect(clipRanges(tone(12), 1000, 20)).toEqual([[0, 12000]]);
  });

  it('cuts a long one in the quiet between transmissions, never past the limit', () => {
    const samples = tone(50);
    samples.fill(0, 17000, 17600); // a gap 17 s in
    samples.fill(0, 36000, 36400); // and another
    const ranges = clipRanges(samples, 1000, 20);
    expect(ranges.map(([a, b]) => b - a).every((n) => n <= 20000)).toBe(true);
    expect(ranges[0]![1]).toBeGreaterThanOrEqual(17000);
    expect(ranges[0]![1]).toBeLessThanOrEqual(17600);
    expect(ranges[1]![1]).toBeGreaterThanOrEqual(36000);
    expect(ranges[1]![1]).toBeLessThanOrEqual(36400);
    expect(ranges.at(-1)![1]).toBe(50000);
    // Nothing lost, nothing sent twice.
    expect(ranges.every(([a], i) => a === (i === 0 ? 0 : ranges[i - 1]![1]))).toBe(true);
  });

  it('knows silence', () => {
    expect(isSilent(new Float32Array(1000))).toBe(true);
    expect(isSilent(tone(1))).toBe(false);
  });
});
