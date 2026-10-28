import type { Id, MapBundle, PlanAction } from '../../contracts.ts';
import type { OfficerStatus, PoliceOrder } from '../../engine/src/edits.ts';
import { buildStep, stepChoices, type Choice, type StepChoices, type StepKind } from './plan-steps.ts';

/**
 * Commands in plain words, typed or dictated (Handy, macOS dictation, or any
 * speech-to-text that types into the box): "close gate 3 in 2 minutes",
 * "send 4 officers to gate 2", "redirect gate 1 to gate 5", "PA: use the west
 * gates". Matching is plain code against this map's own gate, street and place
 * names, so nothing is guessed: a command that names nothing on the map is
 * refused with a hint, and every command is shown back for the commander to
 * confirm before anything happens. No React here, so it is tested under Node.
 */

export type Intent =
  | { kind: 'close' | 'open'; target: Choice; isGate: boolean; atMin: number }
  /** `street` when the place is a street rather than a gate or named place: a live order only. */
  | { kind: 'send_officers'; count: number; place: Choice; street?: boolean; atMin: number }
  | { kind: 'redirect'; from: Choice; to: Choice; atMin: number }
  | { kind: 'alert'; channel: 'pa' | 'phone'; message: string; atMin: number }
  | { kind: 'shelter_order'; atMin: number };

export type Parsed = { ok: true; intent: Intent; summary: string } | { ok: false; error: string };

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, a: 1, an: 1, single: 1, two: 2, couple: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, twenty: 20, thirty: 30,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
};
// Dictation spells numbers its own way: "gate to", "gate for", "gate won".
const DICTATION_SLIPS: [RegExp, string][] = [
  [/\bgate (?:to|too)\b/g, 'gate 2'],
  [/\bgate (?:for|fore)\b/g, 'gate 4'],
  [/\bgate (?:won)\b/g, 'gate 1'],
  [/\bgate (?:ate)\b/g, 'gate 8'],
];

/** Lower case, numbers as digits, punctuation gone (except a colon, which starts an alert's words). */
export function normalise(text: string): string {
  let s = ` ${text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9:\s-]/g, ' ').replace(/-/g, ' ')} `;
  for (const [re, to] of DICTATION_SLIPS) s = s.replace(re, to);
  s = s.replace(/\b(gate|number) number\b/g, '$1');
  s = s.replace(/\b[a-z]+\b/g, (w) => (w in NUMBER_WORDS && !['a', 'an', 'second'].includes(w) ? String(NUMBER_WORDS[w]) : w));
  return s.replace(/\s+/g, ' ').trim();
}

const STREET_SUFFIX: Record<string, string> = { st: 'street', ave: 'avenue', av: 'avenue', rd: 'road', dr: 'drive', blvd: 'boulevard', ln: 'lane', pkwy: 'parkway', hwy: 'highway' };
const COMPASS = new Set(['the', 'of', 'north', 'south', 'east', 'west', 'n', 's', 'e', 'w']);
const FILLER = new Set([...COMPASS, 'and', 'street', 'avenue', 'road', 'drive', 'boulevard', 'lane', 'way', 'parkway', 'highway']);
const words = (s: string) =>
  normalise(s)
    .replace(/:/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => STREET_SUFFIX[w] ?? w);

/** The gate number a choice is for ("Gate 3 (N)" is 3), or null for anything else. */
const gateNumber = (label: string) => {
  const m = /^gate (\d+)\b/i.exec(label.trim());
  return m ? Number(m[1]) : null;
};

/**
 * The choice a stretch of words names. A gate is matched by its number; any
 * other name needs its distinctive words ("woody hayes" for Woody Hayes Drive)
 * to all be there, and the longest such name wins.
 */
export function findChoice(text: string, choices: Choice[]): Choice | null {
  const said = words(text);
  const gate = /\bgate (\d+)\b/.exec(normalise(text));
  if (gate) {
    const n = Number(gate[1]);
    const hit = choices.find((c) => gateNumber(c.label) === n);
    if (hit) return hit;
  }
  let best: { c: Choice; score: number } | null = null;
  for (const c of choices) {
    if (gateNumber(c.label) !== null) continue;
    const name = words(c.label);
    const key = name.filter((w) => !FILLER.has(w));
    // "West Lane Avenue" is all filler words: then only the compass word may be left out.
    const need = key.length ? key : name.filter((w) => !COMPASS.has(w));
    const hit = need.filter((w) => said.includes(w)).length;
    // Every distinctive word, or at least two of three ("northeast lot" for Stadium Lot Northeast).
    if (need.length === 0 || (hit < need.length && (hit < 2 || hit / need.length < 0.66))) continue;
    const score = hit * 10 + (hit === need.length ? 5 : 0) + name.filter((w) => said.includes(w)).length;
    if (!best || score > best.score) best = { c, score };
  }
  return best?.c ?? null;
}

/** Up to three names that share a distinctive word with what was said, for "did you mean". */
export function suggest(text: string, choices: Choice[]): string[] {
  const said = new Set(words(text).filter((w) => !FILLER.has(w) && !/^\d+$/.test(w) && !['lot', 'gate', 'to', 'send', 'officers', 'officer', 'close', 'open'].includes(w)));
  const lot = /\blot\b/.test(normalise(text));
  const near = choices.filter((c) => {
    const name = words(c.label);
    return name.some((w) => said.has(w)) || (lot && name.includes('lot') && words(text).some((w) => COMPASS.has(w) && c.label.toLowerCase().includes(w)));
  });
  return near.slice(0, 3).map((c) => c.label);
}
const didYouMean = (text: string, choices: Choice[]) => {
  const s = suggest(text, choices);
  return s.length ? ` Did you mean ${s.length === 1 ? s[0] : `${s.slice(0, -1).join(', ')} or ${s[s.length - 1]}`}?` : '';
};

/** "in 2 minutes", "after 5 min", "at 10 minutes"; "now" or nothing is 0. */
export function minutesIn(text: string): number {
  const s = normalise(text);
  const m = /\b(?:in|after|at|plus|\+)\s*(\d+(?:\.\d+)?)\s*(?:min|mins|minute|minutes)\b/.exec(s) ?? /\b(\d+(?:\.\d+)?)\s*(?:min|mins|minute|minutes)\s*(?:from now|later|after)\b/.exec(s);
  return m ? Math.min(240, Number(m[1])) : 0;
}

/** Text with a matched name or time taken out, so the next search does not find it again. */
const without = (text: string, part: RegExp) => normalise(text).replace(part, ' ');

const when = (atMin: number) => (atMin === 0 ? 'now' : `${atMin} min after the incident`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function describe(intent: Intent): string {
  switch (intent.kind) {
    case 'close':
    case 'open':
      return `${intent.kind === 'close' ? 'Close' : 'Open'} ${intent.target.label}, ${when(intent.atMin)}`;
    case 'send_officers':
      return `Send ${plural(intent.count, 'officer', 'officers')} to ${intent.place.label}, ${when(intent.atMin)}`;
    case 'redirect':
      return `Redirect fans from ${intent.from.label} to ${intent.to.label}, ${when(intent.atMin)}`;
    case 'alert':
      return `${intent.channel === 'pa' ? 'PA announcement' : 'Phone alert'}: “${intent.message}”, ${when(intent.atMin)}`;
    case 'shelter_order':
      return `Order everyone to shelter, ${when(intent.atMin)}`;
  }
}

const HINT = 'Try “close gate 3”, “send 4 officers to gate 2”, “redirect gate 1 to gate 5” or “PA: use the west gates”.';

export function parseCommand(text: string, map: MapBundle): Parsed {
  const s = normalise(text);
  if (!s) return { ok: false, error: HINT };
  const choices = stepChoices(map);
  const atMin = minutesIn(s);
  const done = (intent: Intent): Parsed => ({ ok: true, intent, summary: describe(intent) });

  // Alerts first: their own words may say "close" or "gate" without being an order to.
  const alert = /^(?:make an? |send an? |do an? )?(pa|announce(?:ment)?|tell (?:everyone|the crowd|fans)|phone|text|sms|push)\b(?: (?:alert|announcement|message))?(?: (?:saying|that|to say))?:?\s*(.*)$/.exec(s);
  if (alert) {
    const channel = /^(phone|text|sms|push)/.test(alert[1]!) ? 'phone' : 'pa';
    // After a colon, keep the commander's own wording and case.
    const message = (text.includes(':') ? text.slice(text.indexOf(':') + 1) : alert[2]!.replace(/\b(?:in|after|at) \d+(?:\.\d+)? (?:min|mins|minute|minutes)\b/, ''))
      .trim()
      .replace(/^["“]|["”]$/g, '')
      .trim();
    if (!message) return { ok: false, error: 'What should the alert say? Try “PA: use the west gates”.' };
    return done({ kind: 'alert', channel, message: message.charAt(0).toUpperCase() + message.slice(1), atMin });
  }

  if (/\b(shelter|take cover|get inside|evacuate to cover)\b/.test(s)) return done({ kind: 'shelter_order', atMin });

  const redirect = /\b(redirect|divert|reroute|re route|move the crowd|move fans|send fans|send the crowd)\b/.exec(s);
  if (redirect) {
    const m = /\bfrom (.+?) to (.+)$/.exec(s) ?? /\b(?:redirect|divert|reroute|re route) (.+?) to (.+)$/.exec(s);
    if (!m) return { ok: false, error: 'Redirect from where to where? Try “redirect gate 1 to gate 5”.' };
    const from = findChoice(m[1]!, choices.gates);
    const to = findChoice(m[2]!.replace(/\b(?:in|after|at) \d+.*$/, ''), choices.places);
    if (!from) return { ok: false, error: `No gate called “${m[1]}” on this map.` };
    if (!to) return { ok: false, error: `No gate or place called “${m[2]}” on this map.` };
    if (from.id === to.id) return { ok: false, error: 'That redirects a gate to itself.' };
    return done({ kind: 'redirect', from, to, atMin });
  }

  const send = /\b(send|dispatch|deploy|move|get)\b(?: (?:me|us))?(?: (?:an?|some|the))? (?:(\d+) )?(?:more )?(officers?|cops?|police|units?|patrols?)\b/.exec(s);
  if (send) {
    const count = Math.max(1, Math.min(40, Number(send[2] ?? (send[3]!.endsWith('s') || send[3] === 'police' ? 2 : 1))));
    const rest = without(s, new RegExp(`^.*?\\b${send[3]}\\b`));
    const where = rest.replace(/\b(?:in|after|at) \d+.*$/, '');
    const place = findChoice(where, choices.places);
    if (place) return done({ kind: 'send_officers', count, place, atMin });
    const streets = choices.closables.filter((c) => !c.id.endsWith('-door'));
    const street = findChoice(where, streets);
    if (street) return done({ kind: 'send_officers', count, place: street, street: true, atMin });
    return { ok: false, error: `Send them where? Name a gate, a street or a place on the map, like “gate 2”.${didYouMean(where, [...choices.places, ...streets])}` };
  }

  const shut = /\b(close|shut|lock|block|barricade|seal|stop traffic on)\b/.test(s);
  const open = /\b(open|reopen|unblock|unlock|clear the barricade on)\b/.test(s);
  if (shut || open) {
    const target = findChoice(s.replace(/\b(?:in|after|at) \d+(?:\.\d+)? (?:min|mins|minute|minutes)\b/, ''), choices.closables);
    if (!target) return { ok: false, error: `No gate or street by that name on this map.${didYouMean(s, choices.closables) || ` ${HINT}`}` };
    return done({ kind: shut && !open ? 'close' : open && !shut ? 'open' : /\bre?open\b/.test(s) ? 'open' : 'close', target, isGate: target.id.endsWith('-door'), atMin });
  }

  return { ok: false, error: `I didn't recognise that as an order. ${HINT}` };
}

/** The plan step an intent adds to a plan, through the same builder the dropdowns use. */
export function toPlanStep(intent: Intent, choices: StepChoices): PlanAction | null {
  const kind: StepKind = intent.kind;
  switch (intent.kind) {
    case 'close':
    case 'open':
      return buildStep({ kind, atMin: intent.atMin, target: intent.target.id }, choices);
    case 'send_officers':
      // A plan sends officers to places; a street is a live order only.
      return intent.street ? null : buildStep({ kind, atMin: intent.atMin, target: intent.place.id, count: intent.count }, choices);
    case 'redirect':
      return buildStep({ kind, atMin: intent.atMin, from: intent.from.id, to: intent.to.id }, choices);
    case 'alert':
      return buildStep({ kind, atMin: intent.atMin, channel: intent.channel, message: intent.message, reachPct: 70 }, choices);
    case 'shelter_order':
      return buildStep({ kind, atMin: intent.atMin }, choices);
  }
}

/**
 * The live police order an intent gives on the plan on the map right now, or a
 * reason it cannot be given live. Officers sent are the nearest ones not
 * already on a job, and the middle cell of the place is where they go.
 */
export function toLiveOrder(intent: Intent, map: MapBundle, officers: OfficerStatus[]): { order: PoliceOrder } | { error: string } {
  switch (intent.kind) {
    case 'close':
    case 'open':
      return { order: intent.isGate ? { type: 'gate', closableId: intent.target.id, closed: intent.kind === 'close' } : { type: 'barricade', closableId: intent.target.id, closed: intent.kind === 'close' } };
    case 'redirect':
      return { order: { type: 'redirect', fromPlaceId: intent.from.id, toPlaceId: intent.to.id } };
    case 'alert':
      return { order: { type: 'alert', channel: intent.channel, message: intent.message, reachShare: 0.7 } };
    case 'send_officers': {
      const cells = (intent.street ? map.closables : map.places).find((p) => p.id === intent.place.id)?.cells ?? [];
      if (cells.length === 0) return { error: `${intent.place.label} has no ground to send officers to.` };
      const toCell = cells[Math.floor(cells.length / 2)]!;
      const tx = toCell % map.width;
      const ty = Math.floor(toCell / map.width);
      const free = officers
        .filter((o) => o.state === 'standby' || o.state === 'patrolling')
        .map((o) => ({ o, d: Math.hypot((o.cell % map.width) - tx, Math.floor(o.cell / map.width) - ty) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, intent.count)
        .map(({ o }) => o.id as Id);
      if (free.length === 0) return { error: 'Every officer is already on a job.' };
      return { order: { type: 'dispatch', officerIds: free, toCell } };
    }
    case 'shelter_order':
      return { error: 'A shelter order is a plan step only. Add it to a plan instead.' };
  }
}

/** What to say back over the speaker once an order is confirmed, radio style. */
export function readBack(intent: Intent, live: boolean): string {
  const how = live ? '' : ', added to the plan';
  switch (intent.kind) {
    case 'close':
      return `Copy. ${intent.target.label} closing${how}.`;
    case 'open':
      return `Copy. ${intent.target.label} opening${how}.`;
    case 'send_officers':
      return `Copy. ${plural(intent.count, 'officer', 'officers')} to ${intent.place.label}${how}.`;
    case 'redirect':
      return `Copy. Fans from ${intent.from.label} going to ${intent.to.label}${how}.`;
    case 'alert':
      return `Copy. ${intent.channel === 'pa' ? 'Announcement' : 'Phone alert'} going out${how}.`;
    case 'shelter_order':
      return `Copy. Everyone to shelter${how}.`;
  }
}
