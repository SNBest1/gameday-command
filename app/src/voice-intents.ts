import type { MapBundle } from '../../contracts.ts';
import { stepChoices, type Choice } from './plan-steps.ts';
import { findChoice, normalise, parseCommand, planSwitch, type Parsed } from './voice-commands.ts';

/**
 * Everything the command box can hear, not just orders: a yes or no to the
 * order on the card, undo, a plan switch, the app's own controls ("pause",
 * "show 2D"), and questions answered from the app's numbers. Orders fall
 * through to `parseCommand`. Plain code against the map's names, like orders;
 * no React here, so it is tested under Node.
 */

export type RailTabId = 'brief' | 'orders' | 'plans' | 'gates' | 'key' | 'about';

export type Control =
  | { kind: 'play' }
  | { kind: 'pause' }
  | { kind: 'speed'; to: 'up' | 'down' | number }
  | { kind: 'view'; view: 'close' | 'plan' | 'compare' }
  | { kind: 'tab'; tab: RailTabId }
  | { kind: 'restart' }
  | { kind: 'zoom'; place: Choice; street: boolean }
  | { kind: 'whole_map' };

export type Question =
  | { kind: 'worst_gate' }
  | { kind: 'gate'; gate: Choice }
  | { kind: 'free_officers' }
  | { kind: 'congested' }
  | { kind: 'status' }
  | { kind: 'help' };

export type Utterance =
  | { type: 'confirm' }
  | { type: 'cancel' }
  | { type: 'undo' }
  | { type: 'show_plan'; plan: number }
  | { type: 'control'; control: Control }
  | { type: 'question'; question: Question }
  | { type: 'order'; parsed: Parsed };

const CONFIRM = /^(?:yes|yeah|yep|yup|confirm|confirmed|do it|go ahead|affirmative|send it|roger|roger that|approved|execute|ok|okay|correct|thats right)(?: please| now| do it)?$/;
const CANCEL = /^(?:no|nope|cancel|cancel that|never ?mind|stop|scratch that|abort|negative|forget it|dont)(?: please| it)?$/;
const UNDO = /^(?:undo|undo that|undo it|undo the last(?: order| one| step)?|take (?:that|it) back|reverse that|revert(?: that)?|go back on that)(?: please| now)?$/;

const TABS: [RegExp, RailTabId][] = [
  [/^brief(?:ing)?$/, 'brief'],
  [/^(?:police )?orders?$/, 'orders'],
  [/^plans$/, 'plans'],
  [/^gates$/, 'gates'],
  [/^(?:(?:map )?key|legend)$/, 'key'],
  [/^about$/, 'about'],
];

function control(s: string, map: MapBundle): Control | null {
  if (/^(?:run|start|play|resume|begin|unpause|continue)(?: the| all)?(?: 3)?(?: plans?| simulations?| sims?| game| clock| runs?)?(?: now| please)?$/.test(s)) return { kind: 'play' };
  if (/^(?:pause|hold|freeze|wait)(?: it| that| the (?:plans|simulation|sim|clock|game))?(?: please| now)?$|^stop the (?:clock|plans|simulation|sim|game)$/.test(s)) return { kind: 'pause' };
  if (/^(?:go |run )?faster$|^speed (?:it )?up$/.test(s)) return { kind: 'speed', to: 'up' };
  if (/^(?:go |run )?slower$|^slow (?:it )?down$/.test(s)) return { kind: 'speed', to: 'down' };
  const sp = /^(?:speed|go|run at|set speed to)? ?(5|20|60)(?: ?x| times)?(?: speed)?$/.exec(s);
  if (sp && /\d/.test(s) && /speed|times|x|go|run/.test(s)) return { kind: 'speed', to: Number(sp[1]) };
  if (/^(?:restart|start over|reset|run (?:it )?again)(?: the)?(?: plans| runs?| simulation| sim)?(?: please| now)?$/.test(s)) return { kind: 'restart' };
  const view = s.replace(/^(?:show|switch to|go to|open|change to)(?: me)?(?: the)? /, '').replace(/ (?:view|mode)$/, '');
  if (/^(?:2 ?d|2d plan|plan view|top down|map view|bird'?s eye)$/.test(view)) return { kind: 'view', view: 'plan' };
  if (/^(?:3 ?d|3d view|close ?up|isometric)$/.test(view)) return { kind: 'view', view: 'close' };
  if (/^(?:all 3(?: plans)?|side by side|compare(?: the plans)?|all plans|every plan)$/.test(view)) return { kind: 'view', view: 'compare' };
  if (/^(?:whole map|zoom out|show everything|the whole map|full map)$/.test(view) || /^zoom (?:all the way )?out$/.test(s)) return { kind: 'whole_map' };
  const tabWords = view.replace(/ (?:tab|panel|page)$/, '');
  for (const [re, tab] of TABS) if (re.test(tabWords) && (view !== tabWords || s !== view)) return { kind: 'tab', tab };
  const zoom = /^(?:zoom (?:in )?(?:to|on|in on|into)|show me|go to|take me to|look at|fly to|focus on|where is) (?:the )?(.+)$/.exec(s);
  if (zoom) {
    const c = stepChoices(map);
    const place = findChoice(zoom[1]!, c.places);
    if (place) return { kind: 'zoom', place, street: false };
    const street = findChoice(zoom[1]!, c.closables.filter((x) => !x.id.endsWith('-door')));
    if (street) return { kind: 'zoom', place: street, street: true };
  }
  return null;
}

function question(s: string, map: MapBundle): Question | null {
  if (/^(?:help|what can i say|what can you do|commands)$/.test(s)) return { kind: 'help' };
  if (/^(?:status|sitrep|situation report|update|give me (?:a |an )?(?:status|update|sitrep))$|^(?:whats|what is) (?:the )?(?:status|situation)|^how (?:are|is) (?:we|it|things) (?:doing|looking|going)/.test(s))
    return { kind: 'status' };
  const asking = /^(?:whats|what|how|which|where|is|are|any|tell me|give me|who|show me how)\b/.test(s);
  if (!asking) return null;
  if (/\b(?:officers?|cops?|units?|police)\b/.test(s) && /\b(?:free|available|standby|left|idle|spare)\b/.test(s)) return { kind: 'free_officers' };
  const gate = /\bgate (\d+)\b/.exec(s);
  if (gate && /\b(?:how many|busy|queue|line|wait|waiting|status|doing|open|closed)\b/.test(s)) {
    const g = findChoice(`gate ${gate[1]}`, stepChoices(map).gates);
    if (g) return { kind: 'gate', gate: g };
  }
  if (/\b(?:worst|busiest|most crowded|biggest queue|longest (?:queue|line)|most people)\b/.test(s) && /\bgates?\b/.test(s)) return { kind: 'worst_gate' };
  if (/\bwhich gate\b/.test(s)) return { kind: 'worst_gate' };
  if (/\b(?:congest\w*|jam\w*|packed|crowded|hotspots?|worst (?:spot|place|area)|danger\w*|trouble)\b/.test(s)) return { kind: 'congested' };
  return null;
}

export function parseUtterance(text: string, map: MapBundle): Utterance {
  const s = normalise(text).replace(/:/g, ' ').replace(/\s+/g, ' ').trim();
  if (CONFIRM.test(s)) return { type: 'confirm' };
  if (CANCEL.test(s)) return { type: 'cancel' };
  if (UNDO.test(s)) return { type: 'undo' };
  const plan = planSwitch(text);
  if (plan !== null) return { type: 'show_plan', plan };
  const q = question(s, map);
  if (q) return { type: 'question', question: q };
  const c = control(s, map);
  if (c) return { type: 'control', control: c };
  return { type: 'order', parsed: parseCommand(text, map) };
}
