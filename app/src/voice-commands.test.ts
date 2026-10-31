import { describe, expect, it } from 'vitest';
import type { MapBundle } from '../../contracts.ts';
import type { OfficerStatus } from '../../engine/src/edits.ts';
import { makeTestMap } from '../../world/src/test-map.ts';
import { stepChoices } from './plan-steps.ts';
import {
  findChoice,
  minutesIn,
  normalise,
  parseCommand,
  planSwitch,
  planTarget,
  readBack,
  toLiveOrder,
  toPlanStep,
} from './voice-commands.ts';

// The test map, plus the kind of names a real stadium has.
const base = makeTestMap();
const map: MapBundle = {
  ...base,
  closables: [
    ...base.closables,
    { id: 'lane-ave', name: 'West Lane Avenue', cells: [5] } as MapBundle['closables'][number],
  ],
  places: [
    ...base.places,
    { id: 'lot-ne', name: 'Stadium Lot Northeast', kind: 'parking', cells: [10, 11, 12], capacity: 500 },
  ],
};
const choices = stepChoices(map);

const intent = (text: string) => {
  const p = parseCommand(text, map);
  if (!p.ok) throw new Error(`${text}: ${p.error}`);
  return p;
};

const officer = (id: string, cell: number, state: OfficerStatus['state'] = 'standby'): OfficerStatus => ({
  id,
  unit: id,
  cell,
  x: 0,
  y: 0,
  state,
  targetCell: cell,
  place: -1,
  homeCell: cell,
  told: 0,
  followed: 0,
  etaS: null,
});

describe('voice and typed commands', () => {
  it('reads numbers the way dictation writes them', () => {
    expect(normalise('Close Gate Three, please!')).toBe('close gate 3 please');
    expect(normalise('send four officers to gate to')).toBe('send 4 officers to gate 2');
    expect(minutesIn('close gate 3 in two minutes')).toBe(2);
    expect(minutesIn('close gate 3 now')).toBe(0);
  });

  it('finds gates by number and streets by their distinctive words', () => {
    expect(findChoice('gate 2', choices.gates)?.id).toBe('test-gate-b');
    expect(findChoice('the plaza', choices.closables)?.id).toBe('test-plaza-lane');
    expect(findChoice('lane avenue', choices.closables)?.id).toBe('lane-ave');
    expect(findChoice('northeast lot', choices.places)?.id).toBe('lot-ne');
    expect(findChoice('gate 9', choices.gates)).toBeNull();
  });

  it('closes and opens gates and streets, with a time', () => {
    const c = intent('Close gate 3 in 2 minutes');
    expect(c.summary).toBe('Close Gate 3, 2 min after the incident');
    expect(toPlanStep(c.intent, choices)).toEqual({ at: 120, type: 'close', closableId: 'test-gate-c-door' });
    expect(intent('shut down West Lane Avenue').intent).toMatchObject({
      kind: 'close',
      target: { id: 'lane-ave' },
      isGate: false,
    });
    expect(intent('reopen gate one').intent).toMatchObject({ kind: 'open', target: { id: 'test-gate-a-door' } });
    expect(intent('unblock the plaza lane').intent).toMatchObject({ kind: 'open' });
  });

  it('sends officers, two by default', () => {
    expect(toPlanStep(intent('send four officers to gate 2').intent, choices)).toEqual({
      at: 0,
      type: 'send_officers',
      count: 4,
      toPlaceId: 'test-gate-b',
    });
    expect(intent('dispatch officers to the north concourse').intent).toMatchObject({
      count: 2,
      place: { id: 'test-concourse' },
    });
    expect(intent('send an officer to gate 1').intent).toMatchObject({ count: 1 });
  });

  it('sends officers to a street as a live order only, and suggests names it nearly matched', () => {
    const st = intent('send 3 cops to lane avenue');
    expect(st.intent).toMatchObject({ kind: 'send_officers', street: true, place: { id: 'lane-ave' } });
    expect(toPlanStep(st.intent, choices)).toBeNull();
    expect(toLiveOrder(st.intent, map, [officer('o1', 0)])).toEqual({
      order: { type: 'dispatch', officerIds: ['o1'], toCell: 5 },
    });
    const vague = parseCommand('send officers to the stadium lot', {
      ...map,
      places: [
        ...map.places,
        { id: 'lot-nw', name: 'Stadium Lot Northwest', kind: 'parking', cells: [20], capacity: 1 },
      ],
    });
    expect(vague.ok).toBe(true); // "stadium lot" is two of three words of both; the first listed wins
    const none = parseCommand('send officers to the northeast corner', map);
    expect(!none.ok && none.error).toContain('Did you mean Stadium Lot Northeast');
  });

  it('redirects between gates', () => {
    const r = intent('redirect fans from gate 1 to gate 3 after 5 minutes');
    expect(toPlanStep(r.intent, choices)).toEqual({
      at: 300,
      type: 'redirect',
      fromPlaceId: 'test-gate-a',
      toPlaceId: 'test-gate-c',
    });
    expect(intent('divert gate 2 to gate 1').intent).toMatchObject({
      from: { id: 'test-gate-b' },
      to: { id: 'test-gate-a' },
    });
  });

  it('keeps an alert in the commander’s own words, even when they say “close” or “gate”', () => {
    const a = intent('PA: Gate 1 is closed, please use Gate 3');
    expect(a.intent).toMatchObject({ kind: 'alert', channel: 'pa', message: 'Gate 1 is closed, please use Gate 3' });
    expect(intent('phone alert saying stay in your seats').intent).toMatchObject({
      channel: 'phone',
      message: 'Stay in your seats',
    });
    expect(intent('order everyone to take cover').intent.kind).toBe('shelter_order');
  });

  it('refuses what it cannot match, with a hint', () => {
    for (const text of [
      'close gate 9',
      'send officers to the moon',
      'make me a sandwich',
      '',
      'redirect gate 1 to gate 1',
      'PA:',
    ]) {
      const p = parseCommand(text, map);
      expect(p.ok, text).toBe(false);
      if (!p.ok) expect(p.error.length).toBeGreaterThan(10);
    }
  });

  it('turns intents into live orders, sending the nearest free officers', () => {
    expect(toLiveOrder(intent('close gate 2').intent, map, [])).toEqual({
      order: { type: 'gate', closableId: 'test-gate-b-door', closed: true },
    });
    expect(toLiveOrder(intent('close lane avenue').intent, map, [])).toEqual({
      order: { type: 'barricade', closableId: 'lane-ave', closed: true },
    });
    const gate = map.places.find((p) => p.id === 'test-gate-a')!;
    const at = gate.cells[0]!;
    const near = officer('near', at);
    const far = officer('far', at + map.width * 40);
    const busy = officer('busy', at, 'en_route');
    const live = toLiveOrder(intent('send 1 officer to gate 1').intent, map, [far, busy, near]);
    expect(live).toMatchObject({ order: { type: 'dispatch', officerIds: ['near'] } });
    expect(toLiveOrder(intent('send 2 officers to gate 1').intent, map, [busy])).toEqual({
      error: 'Every officer is already on a job.',
    });
    expect('error' in toLiveOrder(intent('everyone shelter now').intent, map, [])).toBe(true);
  });

  it('switches the plan on the map, however dictation spells the letter', () => {
    expect(planSwitch('shift to plan B')).toBe(1);
    expect(planSwitch('Show plan C')).toBe(2);
    expect(planSwitch('go back to plan a')).toBe(0);
    expect(planSwitch('switch over to plan bee')).toBe(1);
    expect(planSwitch('plan see')).toBe(2);
    expect(planSwitch('plan two')).toBe(1);
    expect(planSwitch('close gate 3 on plan B')).toBeNull();
    expect(planSwitch('send officers to gate 2')).toBeNull();
  });

  it('aims an order at the plan it names', () => {
    expect(planTarget('Close gate 3 on plan B')).toEqual({ plan: 1, rest: 'Close gate 3' });
    const p = intent('send 4 officers to gate 2 for plan C');
    expect(p.plan).toBe(2);
    expect(p.intent).toMatchObject({ kind: 'send_officers', count: 4, place: { id: 'test-gate-b' } });
    expect(intent('close gate 1, add to plan bee in 2 minutes')).toMatchObject({
      plan: 1,
      intent: { kind: 'close', atMin: 2 },
    });
    expect(intent('PA: please use gate 3 on plan A')).toMatchObject({
      plan: 0,
      intent: { message: 'Please use gate 3' },
    });
    expect(intent('close gate 3').plan).toBeUndefined();
  });

  it('reads back radio style', () => {
    expect(readBack(intent('close gate 3').intent, true)).toBe('Copy. Gate 3 closing.');
    expect(readBack(intent('send 4 officers to gate 2').intent, false)).toBe(
      'Copy. 4 officers to Gate 2, added to the plan.',
    );
  });
});

describe('speech errors', () => {
  it('explains each way listening fails in plain words', async () => {
    const { speechErrorText } = await import('./speech.ts');
    expect(speechErrorText('not-allowed')).toContain('microphone is blocked');
    expect(speechErrorText('network')).toContain('internet');
    expect(speechErrorText('network', true)).toContain('Brave blocks');
    expect(speechErrorText('no-speech')).toContain('didn’t hear');
    expect(speechErrorText('aborted')).toBe('');
  });
});
