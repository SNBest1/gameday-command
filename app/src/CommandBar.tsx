import { useEffect, useMemo, useRef, useState } from 'react';
import type { MapBundle, PlanAction } from '../../contracts.ts';
import type { OfficerStatus, PoliceOrder } from '../../engine/src/index.ts';
import { stepChoices } from './plan-steps.ts';
import { listen, speechConfig, speechConfigReady, speechSupported, type Listening } from './speech.ts';
import { TRANSCRIBING_WORDS } from './speech-recorded.ts';
import { interpretVoice, logVoice, type VoiceLogEntry } from './api.ts';
import { answer, type Facts } from './voice-answers.ts';
import { readBack, toLiveOrder, toPlanStep, type Parsed } from './voice-commands.ts';
import { parseUtterance, type Control, type Utterance } from './voice-intents.ts';
import { fromToolCall, voiceSystemPrompt, voiceTools, type ToolCall } from './voice-tools.ts';
import { VOICE_SESSION_ID } from './voice-session.ts';

/** How long dictation has to pause before the box shows what it understood. */
const DICTATION_PAUSE_MS = 900;

const loadReadBack = () => {
  try {
    return localStorage.getItem('gd-readback') !== 'off';
  } catch {
    return true;
  }
};

/**
 * Speak, then run `then` once the speaker has finished, so the mic opened
 * after it does not hear the app's own voice. With no speech synthesis, or
 * read-back off, `then` runs straight away.
 */
function speak(text: string, on: boolean, then?: () => void) {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!on || !synth) {
    if (then) window.setTimeout(then, 0);
    return;
  }
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    then?.();
  };
  try {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.onend = done;
    u.onerror = done;
    synth.speak(u);
    // Some browsers never fire onend: go on after about how long it takes to say.
    if (then) window.setTimeout(done, 1500 + text.length * 75);
  } catch {
    done();
  }
}

const firstSentence = (s: string) => s.split(/(?<=\.)\s/)[0] ?? s;

type Done = { text: string; tone: 'ok' | 'answer' | 'warn' };
type Undoable = { kind: 'live'; plan: number } | { kind: 'step'; plan: number; step: PlanAction };

export interface CommandBarProps {
  map: MapBundle;
  labels: readonly string[];
  /** Index of the plan on the map, the one an order without a plan name goes to. */
  planOnMap: number;
  officersOf: (plan: number) => OfficerStatus[];
  /** Live orders need a running, live (not replayed) plan. */
  canOrderOn: (plan: number) => boolean;
  /** A live order for one plan; that plan is put on the map with it. */
  onOrder: (plan: number, order: PoliceOrder) => void;
  onAddStep: (plan: number, step: PlanAction) => void;
  /** Take back a step this box added; false if it is no longer there. */
  onRemoveStep: (plan: number, step: PlanAction) => boolean;
  /** Undo the newest live order on a plan; what it did, or null if nothing could be undone. */
  onUndoLive: (plan: number) => string | null;
  onShowPlan: (plan: number) => void;
  /** Carry out a control ("pause", "show 2D"); what happened, for the read-back. */
  onControl: (control: Control) => string;
  /** The numbers spoken answers are built from, for the plan on the map now. */
  facts: () => Facts;
}

/**
 * Orders and questions in plain words, typed or spoken. The mic button, or
 * holding Space, listens through the browser's recogniser (`speech.ts`).
 * Spoken orders are hands-free: the box reads the order back, asks for a yes,
 * and listens again by itself; "yes" gives it, "cancel" drops it. Typed orders
 * are confirmed with the buttons. Controls ("pause", "show 2D") and plan
 * switches happen straight away, since they only change the view or the clock;
 * questions are answered aloud from the app's own numbers; "undo that" takes
 * back the last order. An order goes to the plan it names ("on plan B"), else
 * the plan on the map.
 */
export function CommandBar(props: CommandBarProps) {
  const { map, labels, planOnMap, officersOf, canOrderOn } = props;
  const [text, setText] = useState('');
  const [parsed, setParsedState] = useState<Parsed | null>(null);
  const [heard, setHeard] = useState('');
  const [done, setDone] = useState<Done | null>(null);
  const [readAloud, setReadAloud] = useState(loadReadBack);
  const [listening, setListening] = useState<null | 'command' | 'confirm'>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [understanding, setUnderstanding] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);
  const session = useRef<Listening | null>(null);
  const starting = useRef(false);
  const mounted = useRef(true);
  const pendingLog = useRef<VoiceLogEntry | null>(null);
  const history = useRef<Undoable[]>([]);
  const choices = useMemo(() => stepChoices(map), [map]);

  // Speech callbacks fire long after the render that started them, so they read
  // everything through refs that every render keeps current.
  const parsedRef = useRef<Parsed | null>(null);
  const live = useRef({ props, readAloud });
  live.current = { props, readAloud };
  const setParsed = (p: Parsed | null) => {
    parsedRef.current = p;
    setParsedState(p);
  };

  const say = (message: string, tone: Done['tone'], spoken = message, then?: () => void) => {
    setDone({ text: message, tone });
    speak(spoken, live.current.readAloud, then);
  };

  const postLog = (entry: VoiceLogEntry) => void logVoice(entry).catch(() => {});
  const logOutcome = (outcome: VoiceLogEntry['outcome']) => {
    const base = pendingLog.current;
    if (!base) return;
    pendingLog.current = null;
    postLog({ ...base, outcome });
  };
  const record = (
    utterance: Utterance,
    transcript: string,
    spoken: boolean,
    call: ToolCall | null,
    summary: string,
  ) => {
    const entry: VoiceLogEntry = {
      session: VOICE_SESSION_ID,
      source: spoken ? (speechConfig().stt ? 'stt' : 'browser') : 'typed',
      transcript: transcript.trim(),
      toolCall: call ?? 'fallback',
      summary,
      outcome: 'none',
    };
    postLog(entry);
    if (utterance.type === 'order' && utterance.parsed.ok) pendingLog.current = entry;
  };

  /** Where an order on the card goes, and what can be done with it right now. */
  const options = (p: Parsed | null) => {
    const { planOnMap, canOrderOn, officersOf, map } = live.current.props;
    if (!p?.ok) return null;
    const named = p.plan;
    const target = named ?? planOnMap;
    const step = toPlanStep(p.intent, choices);
    const order = toLiveOrder(p.intent, map, officersOf(target));
    const liveOk = canOrderOn(target) && 'order' in order;
    return { named, target, step, order, liveOk };
  };

  const giveLive = (p: Parsed & { ok: true }, target: number, order: PoliceOrder) => {
    live.current.props.onOrder(target, order);
    history.current.push({ kind: 'live', plan: target });
    logOutcome('confirmed');
    setParsed(null);
    say(`Ordered on plan ${labels[target]}: ${p.summary.replace(/, now$/, '')}.`, 'ok', readBack(p.intent, true));
  };
  const addStep = (p: Parsed & { ok: true }, plan: number, step: PlanAction) => {
    live.current.props.onAddStep(plan, step);
    history.current.push({ kind: 'step', plan, step });
    logOutcome('confirmed');
    setParsed(null);
    say(`Added to plan ${labels[plan]}. Restart with your changes to run it.`, 'ok', readBack(p.intent, false));
  };

  /** "Yes" to the order on the card: give it live if the plan is running, else add it to the plan. */
  const confirm = () => {
    const p = parsedRef.current;
    const o = options(p);
    if (!p?.ok || !o) {
      say('There is no order waiting to confirm.', 'warn');
      return;
    }
    if (o.liveOk && 'order' in o.order) giveLive(p, o.target, o.order.order);
    else if (o.step) addStep(p, o.target, o.step);
    else say('That one needs the plans running. Say “run the plans”, then give it again.', 'warn');
  };

  const undo = () => {
    const last = history.current.pop();
    if (last?.kind === 'step') {
      const ok = live.current.props.onRemoveStep(last.plan, last.step);
      say(
        ok ? `Took that step back out of plan ${labels[last.plan]}.` : 'That step is already gone.',
        ok ? 'ok' : 'warn',
      );
      return;
    }
    const what = live.current.props.onUndoLive(last?.plan ?? live.current.props.planOnMap);
    say(what ? `Undone. ${what}` : 'There is no order to undo.', what ? 'ok' : 'warn');
  };

  async function startListening(mode: 'command' | 'confirm') {
    if (session.current || starting.current) return;
    starting.current = true;
    try {
      await speechConfigReady();
    } finally {
      starting.current = false;
    }
    if (!mounted.current || session.current) return;
    try {
      window.speechSynthesis?.cancel();
    } catch {
      // nothing speaking
    }
    if (timer.current) window.clearTimeout(timer.current);
    setMicError(null);
    setTranscribing(false);
    if (mode === 'command') {
      setParsed(null);
      setDone(null);
    }
    setText('');
    const s = listen(
      (words, final) => {
        if (words === TRANSCRIBING_WORDS) {
          setTranscribing(true);
          return;
        }
        setTranscribing(false);
        setText(words);
        if (final && words) void handle(words, true);
      },
      (error) => {
        session.current = null;
        setListening(null);
        setTranscribing(false);
        // Silence after "say yes" is not an error: the card's buttons are still there.
        if (error && !(mode === 'confirm' && /hear anything/.test(error))) setMicError(error);
      },
    );
    if (!s) {
      setMicError('This browser has no speech recognition. Use Chrome or Safari, or your dictation key.');
      return;
    }
    session.current = s;
    setListening(mode);
  }

  /** Whatever was said or typed: local confirm/cancel/undo first, then the LLM, then today's parser. */
  async function handle(value: string, spoken: boolean) {
    if (timer.current) window.clearTimeout(timer.current);
    if (!value.trim()) return;
    const map = live.current.props.map;
    const local = parseUtterance(value, map);
    if (local.type === 'confirm' || local.type === 'cancel' || local.type === 'undo') {
      apply(local, value, spoken, null);
      return;
    }

    let utterance: Utterance = local;
    let call: ToolCall | null = null;
    await speechConfigReady();
    if (speechConfig().llm) {
      setUnderstanding(true);
      try {
        const result = await interpretVoice({
          text: value,
          tools: voiceTools(map),
          system: voiceSystemPrompt(map, labels),
        });
        const from = result.call ? fromToolCall(result.call, map) : null;
        if (from) {
          utterance = from;
          call = result.call;
        }
      } finally {
        setUnderstanding(false);
      }
    }
    apply(utterance, value, spoken, call);
  }

  function apply(u: Utterance, value: string, spoken: boolean, call: ToolCall | null) {
    setText('');
    setMicError(null);
    switch (u.type) {
      case 'confirm':
        confirm();
        return;
      case 'cancel':
        if (parsedRef.current) {
          setParsed(null);
          logOutcome('cancelled');
          say('Cancelled.', 'warn');
        }
        return;
      case 'undo':
        undo();
        return;
      case 'show_plan': {
        const message = `Showing plan ${labels[u.plan]} on the map.`;
        record(u, value, spoken, call, message);
        live.current.props.onShowPlan(u.plan);
        say(message, 'ok', `Showing plan ${labels[u.plan]}.`);
        return;
      }
      case 'control': {
        const message = live.current.props.onControl(u.control);
        record(u, value, spoken, call, message);
        say(message, 'ok');
        return;
      }
      case 'question': {
        const message = answer(u.question, live.current.props.facts());
        record(u, value, spoken, call, message);
        say(message, 'answer');
        return;
      }
      case 'order': {
        setHeard(value.trim());
        setParsed(u.parsed);
        setDone(null);
        record(u, value, spoken, call, u.parsed.ok ? u.parsed.summary : u.parsed.error);
        if (!spoken) return;
        if (!u.parsed.ok) {
          speak(firstSentence(u.parsed.error), live.current.readAloud);
          return;
        }
        // Hands-free: read it back, ask for a yes, then listen for it.
        const o = options(u.parsed);
        const how = o?.liveOk
          ? 'Say yes to order it now'
          : o?.step
            ? `Say yes to add it to plan ${labels[o.target]}`
            : null;
        if (!how) return;
        speak(`${u.parsed.summary}. ${how}, or cancel.`, live.current.readAloud, () => {
          if (parsedRef.current === u.parsed) void startListening('confirm');
        });
      }
    }
  }

  const toggleMic = () => {
    if (session.current) session.current.stop();
    else void startListening('command');
  };

  // "/" jumps to the box; holding Space anywhere outside a field is push-to-talk.
  useEffect(() => {
    let ptt = false;
    const inField = (t: EventTarget | null) =>
      !!(t as HTMLElement | null)?.closest?.('input, textarea, select, button, [contenteditable]');
    const down = (e: KeyboardEvent) => {
      if (e.key === '/' && !inField(e.target)) {
        e.preventDefault();
        input.current?.focus();
      } else if (e.code === 'Space' && !e.repeat && !inField(e.target)) {
        e.preventDefault();
        ptt = true;
        void startListening('command');
      } else if (e.key === 'Escape' && session.current) {
        session.current.stop();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && ptt) {
        e.preventDefault();
        ptt = false;
        session.current?.stop();
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
    // startListening reads everything through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      mounted.current = false;
      if (timer.current) window.clearTimeout(timer.current);
      session.current?.stop();
    },
    [],
  );

  const o = parsed?.ok ? { named: parsed.plan, target: parsed.plan ?? planOnMap } : null;
  const step = parsed?.ok ? toPlanStep(parsed.intent, choices) : null;
  const order = parsed?.ok && o ? toLiveOrder(parsed.intent, map, officersOf(o.target)) : null;
  const liveOk = !!o && canOrderOn(o.target) && order !== null && 'order' in order;
  // A command that names a plan only offers that plan.
  const addTo = o?.named === undefined ? labels.map((_, i) => i) : [o.named];

  return (
    <div className="command">
      <form
        className="command-bar"
        onSubmit={(e) => {
          e.preventDefault();
          void handle(text, false);
        }}
      >
        <button
          type="button"
          className={`command-mic${listening ? ' on' : ''}`}
          onClick={toggleMic}
          aria-pressed={!!listening}
          aria-label={listening ? 'Stop listening' : 'Speak an order'}
          title={
            speechSupported()
              ? listening
                ? 'Listening. Click to stop.'
                : 'Click and speak, or hold Space'
              : 'This browser has no speech recognition'
          }
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.93V21h2v-2.07A7 7 0 0 0 19 12h-2Z" />
          </svg>
        </button>
        <input
          ref={input}
          value={text}
          aria-label="Order in plain words"
          placeholder={
            listening === 'confirm'
              ? 'Listening for “yes” or “cancel”…'
              : transcribing
                ? 'Transcribing…'
                : understanding
                  ? 'Understanding…'
                  : listening
                    ? 'Listening… say an order or ask a question'
                    : 'Say or type an order or a question: “close gate 3”, “what’s the worst gate?”, “show 2D”'
          }
          onChange={(e) => {
            setText(e.target.value);
            setDone(null);
            // Dictation drops in whole phrases; once it pauses, show what it understood.
            if (timer.current) window.clearTimeout(timer.current);
            const value = e.target.value;
            if (value.trim().split(/\s+/).length >= 2)
              timer.current = window.setTimeout(() => void handle(value, false), DICTATION_PAUSE_MS);
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
        <label className="toggle" title="Speak confirmations and answers aloud">
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
      <p className="command-tip">
        {listening === 'confirm'
          ? 'Say “yes” to go ahead or “cancel”. Or use the buttons.'
          : transcribing
            ? 'Transcribing the recording. This can take a moment.'
            : understanding
              ? 'Understanding the words. The old parser is still there if this fails.'
              : listening
                ? 'Listening. Stop talking when you’re done.'
                : 'Hold Space or click the mic to talk. Try “close gate 3”, “shift to plan B”, “pause”, “what’s the worst gate?” or “undo that”. Press / to type, ? for all shortcuts.'}
      </p>
      {micError && (
        <p className="command-mic-error" role="alert">
          {micError}
        </p>
      )}

      {parsed && (
        <div
          className={`command-card${parsed.ok ? '' : ' refused'}${listening === 'confirm' ? ' asking' : ''}`}
          role="status"
        >
          <p className="command-heard">
            Heard <q>{heard}</q>
          </p>
          {parsed.ok && o ? (
            <>
              <p className="command-summary">{parsed.summary}</p>
              <div className="command-actions">
                {liveOk && order && 'order' in order && (
                  <button className="go" onClick={() => giveLive(parsed, o.target, order.order)}>
                    Order now on plan {labels[o.target]}
                  </button>
                )}
                {step &&
                  addTo.map((i, k) => (
                    <button
                      key={labels[i]}
                      className={!liveOk && k === 0 ? 'go' : undefined}
                      onClick={() => addStep(parsed, i, step)}
                    >
                      Add to plan {labels[i]}
                    </button>
                  ))}
                <button
                  className="ghost"
                  onClick={() => {
                    session.current?.stop();
                    setParsed(null);
                    logOutcome('cancelled');
                  }}
                >
                  Cancel
                </button>
              </div>
              {!step && (
                <p className="command-note">
                  Plans send officers to gates and named places, so this one is a live order only.
                </p>
              )}
              {step && !liveOk && order && 'order' in order && (
                <p className="command-note">Run the plans to give it as a live order too.</p>
              )}
              {o && canOrderOn(o.target) && order && 'error' in order && <p className="command-note">{order.error}</p>}
            </>
          ) : (
            !parsed.ok && <p className="command-summary">{parsed.error}</p>
          )}
        </div>
      )}
      {done && (
        <p className={`command-done ${done.tone}`} role="status">
          {done.text}
        </p>
      )}
    </div>
  );
}
