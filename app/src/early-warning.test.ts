import { describe, expect, it } from 'vitest';
import { areaKey, EarlyWarnings, type WarningSample } from './early-warning.ts';

const area = (
  t: number,
  crowdedPeople: number,
  level: 'watch' | 'high' | 'critical' = 'high',
  where = '300 m from Gate 2',
): WarningSample => ({
  t,
  gates: [],
  areas: [{ where, level, crowdedPeople }],
});
const gate = (t: number, waiting: number, capacityPerMin = 100, open = true): WarningSample => ({
  t,
  gates: [{ name: 'Gate 2', open, waiting, capacityPerMin }],
  areas: [],
});

describe('early warnings', () => {
  it('warns once, minutes before a growing crowd turns critical', () => {
    const w = new EarlyWarnings();
    expect(w.observe(area(0, 1000))).toEqual([]);
    expect(w.observe(area(60, 1300))).toEqual([]); // 300 a minute: 1,700 to go is ~6 min, past the lookahead
    const soon = w.observe(area(120, 1600));
    expect(soon).toHaveLength(1);
    expect(soon[0]).toMatchObject({ stage: 'soon', minutes: 5, key: 'area:Gate 2' });
    expect(soon[0]!.text).toBe(
      '300 m from Gate 2 heading for critical in about 5 min: 1,600 packed, 300 more a minute.',
    );
    expect(w.observe(area(180, 1900))).toEqual([]);
    const now = w.observe(area(240, 3100, 'critical', '320 m from Gate 2'));
    expect(now).toEqual([
      expect.objectContaining({ stage: 'now', minutes: 0, text: 'Critical now 320 m from Gate 2: 3,100 packed.' }),
    ]);
    expect(w.observe(area(300, 3300, 'critical'))).toEqual([]);
  });

  it('says nothing about a crowd that is steady or shrinking', () => {
    const w = new EarlyWarnings();
    for (const [t, v] of [
      [0, 2500],
      [60, 2500],
      [120, 2400],
      [180, 2300],
    ] as const)
      expect(w.observe(area(t, v))).toEqual([]);
  });

  it('stays quiet about a place already critical when first seen, and warns again once it has thinned out', () => {
    const w = new EarlyWarnings();
    expect(w.observe(area(0, 3200, 'critical'))).toEqual([]);
    expect(w.observe(area(60, 3300, 'critical'))).toEqual([]);
    w.observe(area(120, 1500));
    w.observe(area(180, 1500));
    expect(w.observe(area(240, 3200, 'critical'))).toHaveLength(1);
  });

  it('warns about a gate queue getting long, and ignores a shut gate', () => {
    const w = new EarlyWarnings();
    w.observe(gate(0, 500));
    expect(w.observe(gate(60, 800))).toEqual([]); // two readings are not a trend yet
    const soon = w.observe(gate(120, 1100)); // 11 min of queue, +3 min a minute: 15 in ~1
    expect(soon[0]).toMatchObject({
      stage: 'soon',
      minutes: 1,
      text: 'Gate 2 queue passes 15 minutes in about 1 min: 1,100 waiting and growing.',
    });
    expect(w.observe(gate(180, 1600))[0]).toMatchObject({
      stage: 'now',
      text: 'Gate 2 queue is now 16 minutes long: 1,600 waiting.',
    });
    const shut = new EarlyWarnings();
    expect(shut.observe(gate(0, 5000, 0, false))).toEqual([]);
  });

  it('ignores a repeated moment and starts over on reset', () => {
    const w = new EarlyWarnings();
    w.observe(area(0, 2500));
    expect(w.observe(area(60, 3200, 'critical'))).toHaveLength(1);
    expect(w.observe(area(60, 3200, 'critical'))).toEqual([]);
    w.observe(area(0, 2500)); // a rewind
    expect(w.observe(area(60, 3200, 'critical'))).toHaveLength(1);
    expect(areaKey('1,200 m from Gate 4')).toBe('Gate 4');
    expect(areaKey('40 m from Gate 4')).toBe('Gate 4');
  });
});

describe('early warnings about a jam', () => {
  it('names the stopped vehicles when a street turns critical', () => {
    const w = new EarlyWarnings();
    w.observe({
      t: 0,
      gates: [],
      areas: [{ where: 'On Woody Hayes Drive', level: 'high', crowdedPeople: 600, stoppedVehicles: 10 }],
    });
    const [now] = w.observe({
      t: 60,
      gates: [],
      areas: [{ where: 'On Woody Hayes Drive', level: 'critical', crowdedPeople: 635, stoppedVehicles: 38 }],
    });
    expect(now!.text).toBe('Critical now On Woody Hayes Drive: 635 packed, 38 vehicles stopped.');
  });
});
