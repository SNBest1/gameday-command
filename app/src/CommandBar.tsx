import { useEffect, useMemo, useRef, useState } from 'react';
import type { MapBundle, PlanAction } from '../../contracts.ts';
import type { OfficerStatus, PoliceOrder } from '../../engine/src/edits.ts';
import { stepChoices } from './plan-steps.ts';
import { parseCommand, planSwitch, readBack, toLiveOrder, toPlanStep, type Parsed } from './voice-commands.ts';

/** How long dictation has to pause before the box shows what it understood. */
const DICTATION_PAUSE_MS = 900;

const loadReadBack = () => {
  try {
    return localStorage.getItem('gd-readback') !== 'off';
  } catch {
    return true;
  }
};

function speak(text: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    synth.speak(u);
  } catch {
    // no speech synthesis here: the written confirmation is enough
  }
}

/**
 * Orders in plain words, typed or spoken. Dictation (Handy, macOS dictation,
 * anything that types into the focused box) fills the box; after a short pause,
 * or on Enter, the box shows what it understood. Nothing happens until the
 * commander picks: order it now, or add it to a plan. An order goes to the plan
 * it names ("on plan B"), else the plan on the map. "Shift to plan B" on its own
 * only changes the view, so it happens straight away.
 */
export function CommandBar({
  map,
  labels,
  planOnMap,
  officersOf,
  canOrderOn,
  onOrder,
  onAddStep,
  onShowPlan,
}: {
  map: MapBundle;
  labels: readonly string[];
  /** Index of the plan on the map, the one a live order goes to. */
  planOnMap: number;
  officersOf: (plan: number) => OfficerStatus[];
  /** Live orders need a running, live (not replayed) plan. */
  canOrderOn: (plan: number) => boolean;
  /** A live order for one plan; that plan is put on the map with it. */
  onOrder: (plan: number, order: PoliceOrder) => void;
  onAddStep: (plan: number, step: PlanAction) => void;
  onShowPlan: (plan: number) => void;
}) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [heard, setHeard] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [readAloud, setReadAloud] = useState(loadReadBack);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);
  const choices = useMemo(() => stepChoices(map), [map]);

  const understand = (value = text) => {
    if (timer.current) window.clearTimeout(timer.current);
    if (!value.trim()) return;
    const show = planSwitch(value);
    if (show !== null) {
      onShowPlan(show);
      setParsed(null);
      setText('');
      setDone(`Showing plan ${labels[show]} on the map.`);
      if (readAloud) speak(`Showing plan ${labels[show]}.`);
      return;
    }
    setHeard(value.trim());
    setParsed(parseCommand(value, map));
    setDone(null);
  };

  // "/" jumps to the box from anywhere that is not already a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== '/' || t?.closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const finish = (message: string, said: string) => {
    setDone(message);
    setParsed(null);
    setText('');
    if (readAloud) speak(said);
  };

  const intent = parsed?.ok ? parsed.intent : null;
  const named = parsed?.ok ? parsed.plan : undefined;
  const target = named ?? planOnMap;
  const canOrderNow = canOrderOn(target);
  const step = intent ? toPlanStep(intent, choices) : null;
  const live = intent ? toLiveOrder(intent, map, officersOf(target)) : null;
  const liveOk = canOrderNow && live !== null && 'order' in live;
  // A command that names a plan only offers that plan.
  const addTo = named === undefined ? labels.map((_, i) => i) : [named];

  return (
    <div className="command">
      <form
        className="command-bar"
        onSubmit={(e) => {
          e.preventDefault();
          understand();
        }}
      >
        <span className="command-mic" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.93V21h2v-2.07A7 7 0 0 0 19 12h-2Z" /></svg>
        </span>
        <input
          ref={input}
          value={text}
          aria-label="Order in plain words"
          placeholder="Say or type an order: “close gate 3 in 2 minutes”, “send 4 officers to gate 2”, “PA: use gate 1”"
          onChange={(e) => {
            setText(e.target.value);
            setDone(null);
            // Dictation drops in whole phrases; once it pauses, show what it understood.
            if (timer.current) window.clearTimeout(timer.current);
            const value = e.target.value;
            if (value.trim().split(/\s+/).length >= 2) timer.current = window.setTimeout(() => understand(value), DICTATION_PAUSE_MS);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setText('');
              setParsed(null);
            }
          }}
        />
        <button type="submit" disabled={!text.trim()}>
          Check
        </button>
        <label className="toggle" title="Speak each confirmed order back, radio style">
          <input
            type="checkbox"
            checked={readAloud}
            onChange={(e) => {
              setReadAloud(e.target.checked);
              try {
                localStorage.setItem('gd-readback', e.target.checked ? 'on' : 'off');
              } catch {
                // private window: the choice lasts until the page closes
              }
            }}
          />
          Read back
        </label>
      </form>
      <p className="command-tip">Speak with your dictation key (Handy, or Fn twice for Mac dictation) while the box is selected. Say “shift to plan B” to switch plans, or add “on plan C” to an order. Press / to jump here.</p>

      {parsed && (
        <div className={`command-card${parsed.ok ? '' : ' refused'}`} role="status">
          <p className="command-heard">
            Heard <q>{heard}</q>
          </p>
          {parsed.ok ? (
            <>
              <p className="command-summary">{parsed.summary}</p>
              <div className="command-actions">
                {liveOk && (
                  <button
                    className="go"
                    onClick={() => {
                      onOrder(target, live.order);
                      finish(`Ordered on plan ${labels[target]}: ${parsed.summary.replace(/, now$/, '')}.`, readBack(parsed.intent, true));
                    }}
                  >
                    Order now on plan {labels[target]}
                  </button>
                )}
                {step &&
                  addTo.map((i, k) => (
                    <button
                      key={labels[i]}
                      className={!liveOk && k === 0 ? 'go' : undefined}
                      onClick={() => {
                        onAddStep(i, step);
                        finish(`Added to plan ${labels[i]}. Restart with your changes to run it.`, readBack(parsed.intent, false));
                      }}
                    >
                      Add to plan {labels[i]}
                    </button>
                  ))}
                <button className="ghost" onClick={() => setParsed(null)}>
                  Cancel
                </button>
              </div>
              {!step && <p className="command-note">Plans send officers to gates and named places, so this one is a live order only.</p>}
              {step && !canOrderNow && live && 'order' in live && <p className="command-note">Run the plans to give it as a live order too.</p>}
              {canOrderNow && live && 'error' in live && <p className="command-note">{live.error}</p>}
            </>
          ) : (
            <p className="command-summary">{parsed.error}</p>
          )}
        </div>
      )}
      {done && (
        <p className="command-done" role="status">
          {done}
        </p>
      )}
    </div>
  );
}
