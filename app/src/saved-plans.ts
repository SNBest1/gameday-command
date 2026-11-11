import type { IncidentKind, ResponsePlan } from '../../contracts.ts';

/**
 * Plans the commander wrote, kept in this browser per stadium and situation, so
 * an edited plan survives a reload and can be put back into any of A, B or C.
 * Steps switched off when saving are left out: what is saved is what would run.
 */

export interface SavedPlan {
  savedAt: number;
  plan: ResponsePlan;
}

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

const MAX_SAVED = 20;
const keyFor = (mapId: string, kind: IncidentKind) => `gd-plans:${mapId}:${kind}`;

export function listSaved(store: KeyValueStore, mapId: string, kind: IncidentKind): SavedPlan[] {
  try {
    const raw = store.getItem(keyFor(mapId, kind));
    const list = raw ? (JSON.parse(raw) as SavedPlan[]) : [];
    return Array.isArray(list)
      ? list.filter((s) => s?.plan?.forIncident === kind && Array.isArray(s.plan.actions))
      : [];
  } catch {
    return [];
  }
}

function write(store: KeyValueStore, mapId: string, kind: IncidentKind, list: SavedPlan[]) {
  try {
    store.setItem(keyFor(mapId, kind), JSON.stringify(list.slice(0, MAX_SAVED)));
  } catch {
    /* storage full or blocked: the plan stays only in this page */
  }
}

/** Saves a plan under its name, replacing one already saved under that name. Returns the new list. */
export function savePlan(
  store: KeyValueStore,
  mapId: string,
  plan: ResponsePlan,
  disabled: ReadonlySet<number>,
  name: string,
  now = Date.now(),
): SavedPlan[] {
  const kept: ResponsePlan = {
    ...plan,
    id: `saved-${now.toString(36)}`,
    name: name.trim() || plan.name,
    actions: plan.actions.filter((_, i) => !disabled.has(i)),
  };
  const list = [
    { savedAt: now, plan: kept },
    ...listSaved(store, mapId, plan.forIncident).filter((s) => s.plan.name !== kept.name),
  ];
  write(store, mapId, plan.forIncident, list);
  return list.slice(0, MAX_SAVED);
}

export function deleteSaved(store: KeyValueStore, mapId: string, kind: IncidentKind, id: string): SavedPlan[] {
  const list = listSaved(store, mapId, kind).filter((s) => s.plan.id !== id);
  write(store, mapId, kind, list);
  return list;
}

/** A copy to load into a slot, with an id of its own so two slots can hold the same saved plan. */
export function loadable(saved: SavedPlan, slot: string): ResponsePlan {
  return {
    ...saved.plan,
    id: `${saved.plan.id}-${slot}-${Date.now().toString(36)}`,
    actions: saved.plan.actions.map((a) => ({ ...a })),
  };
}
