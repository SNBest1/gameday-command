import type { MapBundle } from '../../contracts.ts';
import type { GateStat, OfficerStatus, PoliceOrder } from '../../engine/src/edits.ts';
import type { PoliceHotspot } from './congestion.ts';
import type { Question } from './voice-intents.ts';

/**
 * Spoken answers, built only from numbers the app already shows for the plan
 * on the map: the gates panel, officers, and the congestion ranking. Nothing
 * is estimated or invented; when there is nothing to report yet, it says so.
 */

export interface Facts {
  map: MapBundle;
  /** "A", "B" or "C": the plan on the map. */
  plan: string;
  /** Sim clock in words, like "12 min after kickoff". */
  clock: string;
  started: boolean;
  gates: GateStat[];
  officers: OfficerStatus[];
  hotspots: PoliceHotspot[];
}

const n = (x: number) => Math.round(x).toLocaleString('en-US');
const gateName = (facts: Facts, g: GateStat) => facts.map.places[g.place]?.name ?? 'A gate';
const plural = (k: number, one: string, many: string) => `${n(k)} ${k === 1 ? one : many}`;

function gateLine(facts: Facts, g: GateStat): string {
  if (!g.open) return `${gateName(facts, g)} is closed, with ${plural(g.waiting, 'person', 'people')} still near it.`;
  return `${gateName(facts, g)}: ${plural(g.waiting, 'person', 'people')} waiting, ${n(g.inPerMin)} a minute getting in.`;
}

const NOT_YET = 'The plans have not started yet. Say “run the plans” first.';

export function answer(q: Question, facts: Facts): string {
  if (q.kind === 'help') {
    return 'Try: close gate 3, send 4 officers to gate 2, PA: use gate 1, shift to plan B, run the plans, show 2D, what is the worst gate, or undo that.';
  }
  if (!facts.started) return NOT_YET;
  const free = facts.officers.filter((o) => o.state === 'standby' || o.state === 'patrolling').length;
  const moving = facts.officers.filter((o) => o.state === 'en_route').length;
  const busiest = [...facts.gates].sort((a, b) => b.waiting - a.waiting)[0];
  const worstSpot = facts.hotspots[0];
  switch (q.kind) {
    case 'worst_gate':
      if (!busiest || busiest.waiting === 0) return `On plan ${facts.plan}, no gate has a queue right now.`;
      return `On plan ${facts.plan}, the busiest is ${gateLine(facts, busiest)}`;
    case 'gate': {
      const g = facts.gates.find((x) => facts.map.places[x.place]?.id === q.gate.id);
      return g ? `On plan ${facts.plan}, ${gateLine(facts, g)}` : `No numbers for ${q.gate.label} yet.`;
    }
    case 'free_officers':
      if (facts.officers.length === 0) return 'No officers on this map.';
      return `On plan ${facts.plan}, ${n(free)} of ${n(facts.officers.length)} officers are free${moving ? `, and ${plural(moving, 'is', 'are')} on the way somewhere` : ''}.`;
    case 'congested':
      if (!worstSpot) return `On plan ${facts.plan}, nothing is congested right now.`;
      return `On plan ${facts.plan}, the worst spot is ${worstSpot.where}, ${worstSpot.level}: ${n(worstSpot.crowdedPeople)} packed${worstSpot.stoppedVehicles ? `, ${n(worstSpot.stoppedVehicles)} vehicles stopped` : ''}.`;
    case 'status': {
      const parts = [`Plan ${facts.plan}, ${facts.clock}.`];
      parts.push(
        busiest && busiest.waiting > 0
          ? `Busiest gate ${gateName(facts, busiest)}, ${n(busiest.waiting)} waiting.`
          : 'No gate queues.',
      );
      if (facts.officers.length) parts.push(`${n(free)} officers free.`);
      parts.push(worstSpot ? `Worst spot ${worstSpot.where}, ${worstSpot.level}.` : 'Nothing congested.');
      return parts.join(' ');
    }
  }
}

/** What undoing a live order did, in words for the read-back. */
export function describeUndo(inverse: PoliceOrder, map: MapBundle): string {
  const closable = (id: string) => map.closables.find((c) => c.id === id)?.name.replace(/ door$/, '') ?? 'That street';
  const place = (id: string) => map.places.find((p) => p.id === id)?.name ?? 'the other gate';
  switch (inverse.type) {
    case 'gate':
      return `${closable(inverse.closableId)} ${inverse.closed ? 'closed again' : 'reopened'}.`;
    case 'barricade':
      return `${inverse.name ?? closable(inverse.closableId)} ${inverse.closed ? 'closed again' : 'reopened'}.`;
    case 'recall':
      return `${plural(inverse.officerIds.length, 'officer', 'officers')} called back to their post.`;
    case 'redirect':
      return `Fans redirected back from ${place(inverse.fromPlaceId)} to ${place(inverse.toPlaceId)}.`;
    default:
      return 'Last order undone.';
  }
}
