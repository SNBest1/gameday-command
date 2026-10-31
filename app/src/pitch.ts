import type { Incident } from '../../contracts.ts';
import { INCIDENT_LABELS } from '../../world/src/incidents.ts';

/** The situation in a sentence a judge gets on first read. */
export function pitchFor(incident: Incident, zoneName: string): string {
  switch (incident.kind) {
    case 'gate_surge':
      return `A late rush piles up at ${zoneName} right at kickoff. Which plan spreads the crowd out before it gets dangerous?`;
    case 'lightning_delay':
      return 'Lightning 30 minutes into the game. Over 100,000 people in open stands have to get under cover. Which plan gets them there safely?';
    case 'suspicious_package':
      return 'An unattended bag closes a street just as the game lets out. Which plan gets everyone home without a crush?';
    default:
      return incident.note ?? INCIDENT_LABELS[incident.kind];
  }
}
