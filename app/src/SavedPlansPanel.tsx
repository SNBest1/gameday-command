import { useEffect, useState } from 'react';
import type { IncidentKind, ResponsePlan } from '../../contracts.ts';
import { deleteSaved, listSaved, loadable, savePlan, type KeyValueStore, type SavedPlan } from './saved-plans.ts';

/** localStorage, or nothing when the browser blocks it. */
function store(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * "My plans": save any of A, B or C as edited, and put a saved plan back into
 * any slot. Loading only changes the plan; it runs on "Restart with my changes",
 * like every other edit.
 */
export function SavedPlansPanel({
  mapId,
  kind,
  labels,
  plans,
  onLoad,
}: {
  mapId: string;
  kind: IncidentKind;
  labels: readonly string[];
  plans: { plan: ResponsePlan; disabled: ReadonlySet<number> }[];
  onLoad: (slot: number, plan: ResponsePlan) => void;
}) {
  const [saved, setSaved] = useState<SavedPlan[]>([]);
  const [from, setFrom] = useState(0);
  const [name, setName] = useState('');
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    const s = store();
    setSaved(s ? listSaved(s, mapId, kind) : []);
    setNote(null);
  }, [mapId, kind]);
  const s = store();
  if (!s) return null;

  return (
    <section className="block saved-plans">
      <h2>My plans</h2>
      <form
        className="saved-plans-save"
        onSubmit={(e) => {
          e.preventDefault();
          const p = plans[from];
          if (!p) return;
          setSaved(savePlan(s, mapId, p.plan, p.disabled, name));
          setNote(`Saved plan ${labels[from]} as “${name.trim() || p.plan.name}”.`);
          setName('');
        }}
      >
        <label>
          Save plan
          <select value={from} onChange={(e) => setFrom(Number(e.target.value))}>
            {labels.map((l, i) => (
              <option key={l} value={i}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={plans[from]?.plan.name ?? 'Name'}
          aria-label="Name for the saved plan"
        />
        <button className="small" type="submit">
          Save
        </button>
      </form>
      {note && <p className="muted">{note}</p>}
      {saved.length === 0 ? (
        <p className="muted">
          Nothing saved for this situation yet. Edit a plan, then save it here to keep it in this browser.
        </p>
      ) : (
        <ul className="saved-plans-list">
          {saved.map((sp) => (
            <li key={sp.plan.id}>
              <span className="saved-name">
                <strong>{sp.plan.name}</strong>
                <em>
                  {sp.plan.actions.length} {sp.plan.actions.length === 1 ? 'step' : 'steps'}, saved{' '}
                  {new Date(sp.savedAt).toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </em>
              </span>
              <span className="saved-actions">
                {labels.map((l, i) => (
                  <button
                    key={l}
                    className="small"
                    title={`Put this plan in slot ${l}`}
                    onClick={() => {
                      onLoad(i, loadable(sp, l));
                      setNote(`Loaded “${sp.plan.name}” into plan ${l}. Restart with your changes to run it.`);
                    }}
                  >
                    Use as {l}
                  </button>
                ))}
                <button
                  className="small quiet"
                  title="Delete this saved plan"
                  onClick={() => setSaved(deleteSaved(s, mapId, kind, sp.plan.id))}
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
