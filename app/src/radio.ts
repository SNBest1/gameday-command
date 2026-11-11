import type { MapBundle } from '../../contracts.ts';
import { stepChoices, type Choice } from './plan-steps.ts';
import { findChoice, normalise } from './voice-commands.ts';

/**
 * Radio traffic, read. A transcript of what came over the radio (from a
 * recording, or a scanner on the line-in) is split into transmissions, and each
 * one is read for three things: which unit is talking, what kind of report it
 * is, and which gate, place or street on this map it names. Plain code against
 * the map's own names, like the command box: nothing is guessed, and a
 * transmission that names no place stays "heard" with no suggestion.
 *
 * Radio never gives an order. A report may carry a suggested command in the
 * command box's own words ("send 2 officers to gate 2"); the commander sends it
 * to the box, where it is confirmed like any other. No React here.
 */

/** The kinds an officer's own report can have (`officer_report` in edits.ts), plus all clear. */
export type RadioKind =
  | 'backup'
  | 'crowd crush'
  | 'medical'
  | 'fight'
  | 'traffic'
  | 'suspicious item'
  | 'all clear'
  | 'other';

export interface RadioReport {
  /** The transmission as heard. */
  text: string;
  /** "Unit 12", "OSU PD 5": whoever identified themselves, if anyone. */
  unit: string | null;
  kind: RadioKind;
  place: Choice | null;
  /** True when the place is a street rather than a gate or named place. */
  street: boolean;
  /** One line for the log: "Unit 12: crowd crush at Gate 2". */
  summary: string;
  /** A command for the box, or null when the report asks for nothing the box can do. */
  suggestion: string | null;
}

/** Most specific first: a transmission about a fight in a crowd is a fight. */
const KINDS: [RadioKind, RegExp][] = [
  [
    'all clear',
    /\b(?:all clear|code 4|situation (?:is )?(?:resolved|under control)|is resolved|under control|disregard|cancel (?:that|backup|the backup)|no longer need(?:ed)?|stand down|back to normal|cleared up)\b/,
  ],
  [
    'medical',
    /\b(?:medical|medic|medics|ems|ambulance|paramedics?|injur\w*|unconscious|unresponsive|collapsed|not breathing|chest pain|seizure|heat stroke|person down|fan down|man down|woman down|bleeding)\b/,
  ],
  [
    'suspicious item',
    /\b(?:suspicious|unattended|abandoned)\b.*\b(?:bag|backpack|package|item|box|suitcase|vehicle|device)\b|\b(?:bag|backpack|package)\b.*\b(?:unattended|suspicious|abandoned)\b|\bbomb\b/,
  ],
  [
    'fight',
    /\b(?:fight\w*|brawl|altercation|disturbance|assault\w*|punch\w*|disorderly|weapon|knife|gun|shots? fired)\b/,
  ],
  [
    'crowd crush',
    /\b(?:crush\w*|crowd\w*|packed|pushing|shoving|surg\w*|bottleneck\w*|backing up|backed up|piling up|too many people|jammed up|overcrowd\w*|line is (?:huge|long|out of control)|queue is (?:huge|long)|cant move|can not move|stampede)\b/,
  ],
  [
    'traffic',
    /\b(?:traffic|gridlock\w*|stalled|collision|accident|crash\w*|blocked|blocking|vehicle (?:stopped|stuck)|cars? (?:stopped|stuck|backed up)|road (?:is )?(?:closed|blocked)|fender bender)\b/,
  ],
  [
    'backup',
    /\b(?:backup|back up|assistance|assist|reinforcements?|more (?:units|officers|bodies|people|help)|additional (?:units|officers)|send (?:help|units|officers|someone)|need (?:help|units|officers|a hand)|requesting (?:units|officers|help))\b/,
  ],
];

/** A request for people, whatever else the transmission is about. */
const ASKS =
  /\b(?:need\w*|request\w*|send|get|want|require\w*|could use)\b.*\b(?:backup|back up|assistance|units?|officers?|help|reinforcements?|bodies|hand)\b|\b(?:backup|assistance)\b/;

const UNIT_WORD =
  '(?:unit|car|officer|post|patrol|squad|team|engine|medic|bike|motor|adam|baker|charlie|david|lincoln|sam|osu pd|pd)';
const UNIT = new RegExp(`\\b(${UNIT_WORD}) ?(\\d{1,3})\\b`);
const COUNT = /\b(\d{1,2}) (?:more |additional |extra )?(?:units?|officers?|cops?|bodies|people|guys)\b/;

const title = (s: string) =>
  s
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bOsu Pd\b/, 'OSU PD')
    .replace(/\bPd\b/, 'PD');

/**
 * A transcript cut into transmissions. Speech-to-text gives sentences; radio
 * gives "over", "copy" and "10-4" between speakers. A piece too short to be a
 * report ("copy", "10-4", "go ahead") is dropped.
 */
export function transmissions(transcript: string): string[] {
  return transcript
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+|\s*\b(?:over and out|over)\b[.,]?\s*|\s*\n+\s*/i)
    .map((s) => s.trim())
    .filter((s) => {
      const n = normalise(s);
      if (n.split(' ').length < 3) return false;
      return !/^(?:10 4|copy(?: that)?|roger(?: that)?|go ahead|stand ?by|say again|affirmative|negative|received)(?: (?:command|dispatch|control))?$/.test(
        n,
      );
    });
}

/** The place a transmission names: a gate or named place first, then a street. */
function placeIn(text: string, map: MapBundle): { place: Choice | null; street: boolean } {
  const c = stepChoices(map);
  const place = findChoice(text, c.places);
  if (place) return { place, street: false };
  const street = findChoice(
    text,
    c.closables.filter((x) => !x.id.endsWith('-door')),
  );
  return { place: street, street: street !== null };
}

export function readTransmission(text: string, map: MapBundle): RadioReport {
  const s = normalise(text).replace(/:/g, ' ').replace(/\s+/g, ' ').trim();
  const u = UNIT.exec(s);
  // "Gate 2" is a place, never a unit; UNIT_WORD has no "gate" for that reason.
  const unit = u ? title(`${u[1]} ${u[2]}`) : null;
  // The unit's own number must not be read as a gate number or a head count.
  const rest = u ? s.replace(u[0], ' ') : s;
  const kind = KINDS.find(([, re]) => re.test(rest))?.[0] ?? 'other';
  const { place, street } = placeIn(rest, map);

  const asks = ASKS.test(rest);
  const count = Math.max(1, Math.min(12, Number(COUNT.exec(rest)?.[1] ?? 2)));
  // Only reports that need people at a place the map knows become a suggestion.
  const wantsOfficers =
    kind === 'backup' ||
    kind === 'crowd crush' ||
    kind === 'fight' ||
    ((kind === 'medical' || kind === 'suspicious item' || kind === 'traffic') && asks);
  const suggestion = place && wantsOfficers ? `send ${count} officers to ${place.label}` : null;

  const what = kind === 'other' ? 'report' : kind;
  const where = place ? ` ${street ? 'on' : 'at'} ${place.label}` : '';
  return {
    text: text.trim(),
    unit,
    kind,
    place,
    street,
    summary: `${unit ? `${unit}: ` : ''}${what}${where}`,
    suggestion,
  };
}

/** Every transmission in a transcript, read. */
export const readRadio = (transcript: string, map: MapBundle): RadioReport[] =>
  transmissions(transcript).map((t) => readTransmission(t, map));
