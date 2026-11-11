import type { EarlyWarning } from './early-warning.ts';

/** How long an early warning stays over the map, in sim seconds. */
const WARNING_BANNER_S = 180;

/** Says a warning aloud when read-back is on; never talks over the command box. */
export function speakWarning(text: string) {
  try {
    if (localStorage.getItem('gd-readback') === 'off') return;
  } catch {
    /* storage blocked: read-back defaults on */
  }
  const synth = globalThis.speechSynthesis;
  if (!synth || synth.speaking) return;
  synth.speak(new SpeechSynthesisUtterance(`Warning. ${text}`));
}

/** What is about to turn critical on the plan on the map, from the trend of its own numbers. */
export function WarningBanner({
  warning,
  t,
  onDismiss,
}: {
  warning: EarlyWarning | null;
  t: number;
  onDismiss: () => void;
}) {
  if (!warning || t - warning.t > WARNING_BANNER_S || t < warning.t) return null;
  return (
    <div className={`warning-banner ${warning.stage}`} role="status">
      <strong>{warning.stage === 'now' ? 'Critical' : `Critical in ~${warning.minutes} min`}</strong>
      <span>{warning.text}</span>
      <button className="small" onClick={onDismiss} aria-label="Dismiss warning">
        Dismiss
      </button>
    </div>
  );
}
