import type { MapBundle } from '../../contracts.ts';
import type { Parsed, Intent } from './voice-commands.ts';
import { describe, findChoice } from './voice-commands.ts';
import { stepChoices, type Choice } from './plan-steps.ts';
import type { RailTabId, Utterance } from './voice-intents.ts';

/**
 * The command box's vocabulary as OpenAI tool definitions, plus the resolver
 * back to the Utterance shape `parseUtterance` already uses. The model only
 * proposes names; `findChoice` confirms them against this map.
 */

export interface VoiceTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties: false;
    };
  };
}

export interface ToolCall {
  name: string;
  arguments: unknown;
}

const MAX_SYSTEM_CHARS = 8000;
const PLAN = { type: 'string', enum: ['A', 'B', 'C'] };
const AT_MIN = { type: 'number', minimum: 0, maximum: 240 };
const NAME = (what: string) => ({ type: 'string', description: `Exact ${what} name from the system prompt` });

const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = [],
): VoiceTool => ({
  type: 'function',
  function: {
    name,
    description,
    parameters: { type: 'object', properties, required, additionalProperties: false },
  },
});

const ORDER_TARGET = { target: NAME('gate or street'), atMin: AT_MIN, plan: PLAN };

/** One function per kind the box understands. */
export function voiceTools(map: MapBundle): VoiceTool[] {
  const choices = stepChoices(map);
  const gate = choices.gates[0]?.label;
  return [
    tool('close', 'Close a gate or street', ORDER_TARGET, ['target']),
    tool('open', 'Open a gate or street', ORDER_TARGET, ['target']),
    tool(
      'send_officers',
      'Send officers to a gate, place or street',
      {
        count: { type: 'number', minimum: 1, maximum: 40 },
        place: NAME('place or street'),
        street: { type: 'boolean' },
        atMin: AT_MIN,
        plan: PLAN,
      },
      ['count', 'place'],
    ),
    tool(
      'redirect',
      'Redirect fans from one gate to another place',
      { from: NAME('gate'), to: NAME('place'), atMin: AT_MIN, plan: PLAN },
      ['from', 'to'],
    ),
    tool(
      'alert',
      'Send a PA announcement or phone alert',
      { channel: { type: 'string', enum: ['pa', 'phone'] }, message: { type: 'string' }, atMin: AT_MIN, plan: PLAN },
      ['channel', 'message'],
    ),
    tool('shelter_order', 'Order everyone to shelter', { atMin: AT_MIN, plan: PLAN }),
    tool('play', 'Run or resume the plans'),
    tool('pause', 'Pause the simulation'),
    tool('speed', 'Change the simulation speed', { to: { enum: ['up', 'down', 5, 20, 60] } }, ['to']),
    tool('view', 'Switch the map view', { view: { type: 'string', enum: ['ops', 'close', 'plan', 'compare'] } }, [
      'view',
    ]),
    tool(
      'tab',
      'Open a rail tab',
      { tab: { type: 'string', enum: ['brief', 'orders', 'plans', 'gates', 'key', 'about'] satisfies RailTabId[] } },
      ['tab'],
    ),
    tool('restart', 'Restart all three plans'),
    tool(
      'zoom',
      'Focus the map on a named gate, place or street',
      {
        place: NAME(gate ? `gate, place or street (for example ${gate})` : 'gate, place or street'),
        street: { type: 'boolean' },
      },
      ['place'],
    ),
    tool('whole_map', 'Show the whole map'),
    tool('worst_gate', 'Answer which gate is busiest'),
    tool('gate', 'Answer a question about one gate', { gate: NAME('gate') }, ['gate']),
    tool('free_officers', 'Answer how many officers are free'),
    tool('congested', 'Answer where it is most congested'),
    tool('status', 'Answer for a short situation report'),
    tool('help', 'List what the commander can say'),
    tool('show_plan', 'Put one plan on the map', { plan: PLAN }, ['plan']),
    tool('none', 'Use when the words are not a command'),
  ];
}

/** The system prompt: role, rules and this map's own names, under 8,000 characters. */
export function voiceSystemPrompt(map: MapBundle, labels: readonly string[]): string {
  const choices = stepChoices(map);
  const gateIds = new Set(choices.gates.map((g) => g.id));
  const places = choices.places.filter((p) => !gateIds.has(p.id)).map((p) => p.label);
  const streets = choices.closables.filter((c) => !c.id.endsWith('-door')).map((c) => c.label);

  const build = (withStreets: boolean) =>
    [
      'You turn a police commander’s words into exactly one tool call.',
      'Never invent a gate, place or street; use the none tool when unsure.',
      'Use one tool call only. Numbers spoken as words become digits.',
      `Plans are ${labels.join(', ')}.`,
      `Gates: ${choices.gates.map((g) => g.label).join(', ')}.`,
      `Other places: ${places.join(', ')}.`,
      ...(withStreets ? [`Streets: ${streets.join(', ')}.`] : []),
    ].join('\n');

  let text = build(true);
  if (text.length > MAX_SYSTEM_CHARS) text = build(false);
  return text.length > MAX_SYSTEM_CHARS ? `${text.slice(0, MAX_SYSTEM_CHARS - 3)}...` : text;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const stringArg = (args: Record<string, unknown>, key: string): string | null =>
  typeof args[key] === 'string' && args[key].trim() !== '' ? args[key] : null;

const atMinArg = (args: Record<string, unknown>): number => {
  if (args.atMin === undefined) return 0;
  const value = Number(args.atMin);
  return Number.isFinite(value) ? Math.max(0, Math.min(240, value)) : 0;
};

const planArg = (args: Record<string, unknown>): number | null | 'bad' => {
  if (args.plan === undefined) return null;
  const index = ['A', 'B', 'C'].indexOf(String(args.plan).toUpperCase());
  return index >= 0 ? index : 'bad';
};

function order(intent: Intent, args: Record<string, unknown>): Utterance | null {
  const plan = planArg(args);
  if (plan === 'bad') return null;
  const parsed: Parsed = { ok: true, intent, summary: describe(intent), ...(plan === null ? {} : { plan }) };
  return { type: 'order', parsed };
}

function streetChoices(choices: ReturnType<typeof stepChoices>): Choice[] {
  return choices.closables.filter((c) => !c.id.endsWith('-door'));
}

/**
 * The call as the same Utterance `parseUtterance` returns. Any unresolved
 * name, missing field or `none` returns null so the caller falls back.
 */
export function fromToolCall(call: ToolCall, map: MapBundle): Utterance | null {
  if (!isRecord(call.arguments)) return null;
  const args = call.arguments;
  const choices = stepChoices(map);

  switch (call.name) {
    case 'close':
    case 'open': {
      const target = stringArg(args, 'target');
      if (!target) return null;
      const choice = findChoice(target, choices.closables);
      if (!choice) return null;
      return order(
        { kind: call.name, target: choice, isGate: choice.id.endsWith('-door'), atMin: atMinArg(args) },
        args,
      );
    }
    case 'send_officers': {
      const count = Number(args.count);
      const name = stringArg(args, 'place');
      if (!name || !Number.isFinite(count) || count < 1 || count > 40) return null;
      const place = findChoice(name, choices.places);
      if (place) return order({ kind: 'send_officers', count: Math.round(count), place, atMin: atMinArg(args) }, args);
      const street = findChoice(name, streetChoices(choices));
      if (!street) return null;
      return order(
        { kind: 'send_officers', count: Math.round(count), place: street, street: true, atMin: atMinArg(args) },
        args,
      );
    }
    case 'redirect': {
      const fromName = stringArg(args, 'from');
      const toName = stringArg(args, 'to');
      if (!fromName || !toName) return null;
      const from = findChoice(fromName, choices.gates);
      const to = findChoice(toName, choices.places);
      if (!from || !to || from.id === to.id) return null;
      return order({ kind: 'redirect', from, to, atMin: atMinArg(args) }, args);
    }
    case 'alert': {
      const channel = args.channel === 'pa' || args.channel === 'phone' ? args.channel : null;
      const message = stringArg(args, 'message');
      if (!channel || !message) return null;
      return order(
        { kind: 'alert', channel, message: message.charAt(0).toUpperCase() + message.slice(1), atMin: atMinArg(args) },
        args,
      );
    }
    case 'shelter_order':
      return order({ kind: 'shelter_order', atMin: atMinArg(args) }, args);
    case 'play':
      return { type: 'control', control: { kind: 'play' } };
    case 'pause':
      return { type: 'control', control: { kind: 'pause' } };
    case 'restart':
      return { type: 'control', control: { kind: 'restart' } };
    case 'whole_map':
      return { type: 'control', control: { kind: 'whole_map' } };
    case 'speed': {
      const to = args.to;
      if (
        to !== 'up' &&
        to !== 'down' &&
        to !== 5 &&
        to !== 20 &&
        to !== 60 &&
        to !== '5' &&
        to !== '20' &&
        to !== '60'
      )
        return null;
      const value = to === 'up' || to === 'down' ? to : Number(to);
      return { type: 'control', control: { kind: 'speed', to: value } };
    }
    case 'view': {
      const view = args.view;
      if (view !== 'ops' && view !== 'close' && view !== 'plan' && view !== 'compare') return null;
      return { type: 'control', control: { kind: 'view', view } };
    }
    case 'tab': {
      const tab = args.tab;
      if (tab !== 'brief' && tab !== 'orders' && tab !== 'plans' && tab !== 'gates' && tab !== 'key' && tab !== 'about')
        return null;
      return { type: 'control', control: { kind: 'tab', tab } };
    }
    case 'zoom': {
      const name = stringArg(args, 'place');
      if (!name) return null;
      const streetFirst = args.street === true;
      const place = streetFirst
        ? findChoice(name, streetChoices(choices))
        : (findChoice(name, choices.places) ?? findChoice(name, streetChoices(choices)));
      if (!place) return null;
      const street = streetChoices(choices).some((c) => c.id === place.id);
      return { type: 'control', control: { kind: 'zoom', place, street } };
    }
    case 'show_plan': {
      const plan = planArg(args);
      return plan === null || plan === 'bad' ? null : { type: 'show_plan', plan };
    }
    case 'worst_gate':
      return { type: 'question', question: { kind: 'worst_gate' } };
    case 'gate': {
      const name = stringArg(args, 'gate');
      if (!name) return null;
      const gate = findChoice(name, choices.gates);
      return gate ? { type: 'question', question: { kind: 'gate', gate } } : null;
    }
    case 'free_officers':
      return { type: 'question', question: { kind: 'free_officers' } };
    case 'congested':
      return { type: 'question', question: { kind: 'congested' } };
    case 'status':
      return { type: 'question', question: { kind: 'status' } };
    case 'help':
      return { type: 'question', question: { kind: 'help' } };
    default:
      return null;
  }
}
