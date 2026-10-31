import { describe, expect, it } from 'vitest';
import type { MapBundle } from '../../contracts.ts';
import { makeTestMap } from '../../world/src/test-map.ts';
import { fromToolCall, safeFromToolCall, voiceSystemPrompt, voiceTools } from './voice-tools.ts';

// The test map, plus the kind of names a real stadium has (mirrors voice-commands.test).
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

describe('voice tool schema', () => {
  it('has one tool for every Intent, Control and Question kind, plus show_plan and none', () => {
    const names = voiceTools(map).map((tool) => tool.function.name);
    for (const name of [
      'close',
      'open',
      'send_officers',
      'redirect',
      'alert',
      'shelter_order',
      'play',
      'pause',
      'speed',
      'view',
      'tab',
      'restart',
      'zoom',
      'whole_map',
      'worst_gate',
      'gate',
      'free_officers',
      'congested',
      'status',
      'help',
      'show_plan',
      'none',
    ])
      expect(names, name).toContain(name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('resolves the definition-of-done examples', () => {
    const send = fromToolCall({ name: 'send_officers', arguments: { count: 4, place: 'Stadium Lot Northeast' } }, map);
    expect(send).toMatchObject({ type: 'order', parsed: { intent: { kind: 'send_officers', count: 4 } } });
    if (send?.type === 'order' && send.parsed.ok) expect(send.parsed.intent).toMatchObject({ place: { id: 'lot-ne' } });

    expect(fromToolCall({ name: 'close', arguments: { target: 'Gate 2' } }, map)).toMatchObject({
      type: 'order',
      parsed: { intent: { kind: 'close', target: { id: 'test-gate-b-door' }, isGate: true } },
    });
    expect(fromToolCall({ name: 'gate', arguments: { gate: 'Gate 2' } }, map)).toMatchObject({
      type: 'question',
      question: { kind: 'gate', gate: { id: 'test-gate-b' } },
    });
    expect(fromToolCall({ name: 'view', arguments: { view: 'ops' } }, map)).toEqual({
      type: 'control',
      control: { kind: 'view', view: 'ops' },
    });
  });

  it('returns null for an invented place, none, or a missing field', () => {
    expect(fromToolCall({ name: 'send_officers', arguments: { count: 2, place: 'Moon Base Alpha' } }, map)).toBeNull();
    expect(fromToolCall({ name: 'none', arguments: {} }, map)).toBeNull();
    expect(fromToolCall({ name: 'close', arguments: {} }, map)).toBeNull();
    expect(fromToolCall({ name: 'view', arguments: { view: 'satellite' } }, map)).toBeNull();
  });

  it('falls back instead of throwing on a malformed call', () => {
    const args = Object.defineProperty({}, 'target', {
      get() {
        throw new Error('bad arguments');
      },
    });
    expect(safeFromToolCall({ name: 'close', arguments: args }, map)).toBeNull();
  });

  it('keeps the system prompt under 8,000 characters and names the map', () => {
    const prompt = voiceSystemPrompt(map, ['A', 'B', 'C']);
    expect(prompt.length).toBeLessThan(8000);
    expect(prompt).toContain('Gate 2');
    expect(prompt).toContain('Stadium Lot Northeast');
    expect(prompt).toContain('West Lane Avenue');
    expect(prompt).toContain('none tool');
  });
});
