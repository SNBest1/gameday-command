import { describe, expect, it } from 'vitest';
import type { GateStat, OfficerStatus } from '../../engine/src/edits.ts';
import { makeTestMap } from '../../world/src/test-map.ts';
import type { PoliceHotspot } from './congestion.ts';
import { answer, describeUndo, type Facts } from './voice-answers.ts';
import { parseUtterance } from './voice-intents.ts';

const map = makeTestMap();
const kind = (text: string) => parseUtterance(text, map);
const gateIndex = (id: string) => map.places.findIndex((p) => p.id === id);

describe('what the command box hears', () => {
  it('hears a yes, a no and an undo', () => {
    for (const t of ['yes', 'Yes.', 'confirm', 'do it', 'go ahead', 'okay', 'roger that'])
      expect(kind(t).type, t).toBe('confirm');
    for (const t of ['no', 'cancel', 'never mind', 'scratch that', 'stop']) expect(kind(t).type, t).toBe('cancel');
    for (const t of ['undo', 'undo that', 'take that back', 'undo the last order'])
      expect(kind(t).type, t).toBe('undo');
  });

  it('runs the app by voice', () => {
    expect(kind('run the plans')).toEqual({ type: 'control', control: { kind: 'play' } });
    expect(kind('start')).toEqual({ type: 'control', control: { kind: 'play' } });
    expect(kind('pause')).toEqual({ type: 'control', control: { kind: 'pause' } });
    expect(kind('stop the clock')).toEqual({ type: 'control', control: { kind: 'pause' } });
    expect(kind('go faster')).toEqual({ type: 'control', control: { kind: 'speed', to: 'up' } });
    expect(kind('slow down')).toEqual({ type: 'control', control: { kind: 'speed', to: 'down' } });
    expect(kind('sixty times speed')).toEqual({ type: 'control', control: { kind: 'speed', to: 60 } });
    expect(kind('show 2D')).toEqual({ type: 'control', control: { kind: 'view', view: 'plan' } });
    expect(kind('show the three d view')).toEqual({ type: 'control', control: { kind: 'view', view: 'close' } });
    expect(kind('show all three')).toEqual({ type: 'control', control: { kind: 'view', view: 'compare' } });
    expect(kind('side by side')).toEqual({ type: 'control', control: { kind: 'view', view: 'compare' } });
    expect(kind('open the orders tab')).toEqual({ type: 'control', control: { kind: 'tab', tab: 'orders' } });
    expect(kind('show gates')).toEqual({ type: 'control', control: { kind: 'tab', tab: 'gates' } });
    expect(kind('restart the plans')).toEqual({ type: 'control', control: { kind: 'restart' } });
    expect(kind('zoom out')).toEqual({ type: 'control', control: { kind: 'whole_map' } });
    expect(kind('zoom in on gate 2')).toMatchObject({
      type: 'control',
      control: { kind: 'zoom', place: { id: 'test-gate-b' } },
    });
    expect(kind('take me to the plaza lane')).toMatchObject({
      type: 'control',
      control: { kind: 'zoom', street: true },
    });
  });

  it('keeps orders and plan switches apart from controls', () => {
    expect(kind('open gate 3')).toMatchObject({ type: 'order', parsed: { ok: true, intent: { kind: 'open' } } });
    expect(kind('shift to plan B')).toEqual({ type: 'show_plan', plan: 1 });
    expect(kind('show plan c')).toEqual({ type: 'show_plan', plan: 2 });
    expect(kind('close gate 2')).toMatchObject({ type: 'order', parsed: { ok: true } });
  });

  it('hears questions', () => {
    expect(kind("what's the worst gate")).toEqual({ type: 'question', question: { kind: 'worst_gate' } });
    expect(kind('which gate is busiest right now')).toEqual({ type: 'question', question: { kind: 'worst_gate' } });
    expect(kind('how many people are waiting at gate 2')).toMatchObject({
      type: 'question',
      question: { kind: 'gate', gate: { id: 'test-gate-b' } },
    });
    expect(kind('how many officers are free')).toEqual({ type: 'question', question: { kind: 'free_officers' } });
    expect(kind('where is it congested')).toEqual({ type: 'question', question: { kind: 'congested' } });
    expect(kind('status')).toEqual({ type: 'question', question: { kind: 'status' } });
    expect(kind('how are we doing')).toEqual({ type: 'question', question: { kind: 'status' } });
    expect(kind('what can I say')).toEqual({ type: 'question', question: { kind: 'help' } });
  });
});

const gate = (id: string, waiting: number, open = true, inPerMin = 40): GateStat => ({
  place: gateIndex(id),
  open,
  inPerMin,
  outPerMin: 0,
  waiting,
  capacityPerMin: 100,
  officers: 0,
});
const officer = (state: OfficerStatus['state']): OfficerStatus => ({
  id: state,
  unit: state,
  cell: 0,
  x: 0,
  y: 0,
  state,
  targetCell: 0,
  place: -1,
  homeCell: 0,
  told: 0,
  followed: 0,
  etaS: null,
});
const spot = {
  rank: 1,
  kind: 'crowd',
  level: 'critical',
  where: '300 m from Gate 2',
  crowdedPeople: 1250,
  peakDensity: 5,
  stoppedVehicles: 0,
  slowVehicles: 0,
  score: 1,
  x0: 0,
  y0: 0,
  x1: 1,
  y1: 1,
  cx: 0,
  cy: 0,
} as unknown as PoliceHotspot;
const facts: Facts = {
  map,
  plan: 'A',
  clock: '5 min after kickoff',
  started: true,
  gates: [gate('test-gate-a', 120), gate('test-gate-b', 1400, true, 85), gate('test-gate-c', 30, false)],
  officers: [officer('standby'), officer('standby'), officer('en_route'), officer('on_scene')],
  hotspots: [spot],
};

describe('spoken answers', () => {
  it('answers from the plan’s own numbers', () => {
    expect(answer({ kind: 'worst_gate' }, facts)).toBe(
      'On plan A, the busiest is Gate 2: 1,400 people waiting, 85 a minute getting in.',
    );
    expect(answer({ kind: 'gate', gate: { id: 'test-gate-c', label: 'Gate 3' } }, facts)).toBe(
      'On plan A, Gate 3 is closed, with 30 people still near it.',
    );
    expect(answer({ kind: 'free_officers' }, facts)).toBe(
      'On plan A, 2 of 4 officers are free, and 1 is on the way somewhere.',
    );
    expect(answer({ kind: 'congested' }, facts)).toBe(
      'On plan A, the worst spot is 300 m from Gate 2, critical: 1,250 packed.',
    );
    expect(answer({ kind: 'status' }, facts)).toBe(
      'Plan A, 5 min after kickoff. Busiest gate Gate 2, 1,400 waiting. 2 officers free. Worst spot 300 m from Gate 2, critical.',
    );
  });

  it('says when there is nothing to report, rather than guessing', () => {
    expect(answer({ kind: 'worst_gate' }, { ...facts, started: false })).toContain('not started');
    expect(answer({ kind: 'congested' }, { ...facts, hotspots: [] })).toBe(
      'On plan A, nothing is congested right now.',
    );
    expect(answer({ kind: 'help' }, { ...facts, started: false })).toContain('close gate 3');
  });

  it('describes an undo', () => {
    expect(describeUndo({ type: 'gate', closableId: 'test-gate-b-door', closed: false }, map)).toBe('Gate 2 reopened.');
    expect(describeUndo({ type: 'recall', officerIds: ['a', 'b'] }, map)).toBe('2 officers called back to their post.');
    expect(describeUndo({ type: 'redirect', fromPlaceId: 'test-gate-c', toPlaceId: 'test-gate-a' }, map)).toBe(
      'Fans redirected back from Gate 3 to Gate 1.',
    );
  });
});
