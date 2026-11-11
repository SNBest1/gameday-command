import { describe, expect, it } from 'vitest';
import type { ResponsePlan } from '../../contracts.ts';
import { deleteSaved, listSaved, loadable, savePlan, type KeyValueStore } from './saved-plans.ts';

const memory = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

const plan: ResponsePlan = {
  id: 'surge-a',
  name: 'Six officers to Gate 2',
  forIncident: 'gate_surge',
  officersAvailable: 6,
  actions: [
    { at: 0, type: 'send_officers', count: 6, toPlaceId: 'gate-2' },
    { at: 60, type: 'alert', channel: 'pa', message: 'Use Gate 1', reachShare: 0.8 },
  ],
};

describe('saved plans', () => {
  it('keeps what would run, under the name given, per stadium and situation', () => {
    const s = memory();
    const list = savePlan(s, 'ohio', plan, new Set([1]), '  Officers only ', 1000);
    expect(list).toHaveLength(1);
    expect(list[0]!.plan).toMatchObject({
      name: 'Officers only',
      forIncident: 'gate_surge',
      actions: [plan.actions[0]],
    });
    expect(listSaved(s, 'ohio', 'gate_surge')).toEqual(list);
    expect(listSaved(s, 'ohio', 'lightning_delay')).toEqual([]);
    expect(listSaved(s, 'lumen', 'gate_surge')).toEqual([]);
  });

  it('replaces a plan saved under the same name and puts the newest first', () => {
    const s = memory();
    savePlan(s, 'ohio', plan, new Set(), 'Mine', 1);
    savePlan(s, 'ohio', plan, new Set(), 'Other', 2);
    const list = savePlan(s, 'ohio', plan, new Set([0]), 'Mine', 3);
    expect(list.map((x) => x.plan.name)).toEqual(['Mine', 'Other']);
    expect(list[0]!.plan.actions).toHaveLength(1);
  });

  it('deletes one, and loads a copy with its own id', () => {
    const s = memory();
    const [saved] = savePlan(s, 'ohio', plan, new Set(), '', 5);
    expect(saved!.plan.name).toBe('Six officers to Gate 2');
    const copy = loadable(saved!, 'B');
    expect(copy.id).not.toBe(saved!.plan.id);
    expect(copy.actions).toEqual(saved!.plan.actions);
    expect(copy.actions[0]).not.toBe(saved!.plan.actions[0]);
    expect(deleteSaved(s, 'ohio', 'gate_surge', saved!.plan.id)).toEqual([]);
  });

  it('survives junk in storage', () => {
    const s = memory();
    s.setItem('gd-plans:ohio:gate_surge', '{not json');
    expect(listSaved(s, 'ohio', 'gate_surge')).toEqual([]);
  });
});
