import type { Incident, MapBundle } from '../../contracts.ts';
import type { OfficerStatus } from '../../engine/src/index.ts';
import { INCIDENT_LABELS } from '../../world/src/incidents.ts';
import { minutes, n } from './app-config.ts';
import { policeCopy } from './police-copy.ts';
import { clockText } from './story.ts';
import { ThemeToggle } from './ThemeToggle.tsx';

export function AppHeader({
  loaded,
  incidents,
  incident,
  incidentIndex,
  onIncident,
  t,
  status,
  progress,
  timeWindow,
  fansPerDot,
  liveDots,
  liveFans,
  officerRole,
  own,
  onChangeStadium,
  onRole,
}: {
  loaded: { map: MapBundle } | null;
  incidents: Incident[];
  incident: Incident | undefined;
  incidentIndex: number;
  onIncident: (index: number) => void;
  t: number;
  status: { text: string; phase: 'before' | 'during' } | null;
  progress: number;
  timeWindow: { startAt: number; endAt: number };
  fansPerDot: number | null;
  liveDots: number;
  liveFans: number;
  officerRole: boolean;
  own: OfficerStatus | undefined;
  onChangeStadium: () => void;
  onRole: () => void;
}) {
  return (
    <header className="top">
      <div className="venue">
        <span className="venue-stripe" aria-hidden="true" />
        <div>
          <h1>{loaded ? loaded.map.name.replace(/ \+ 0\.5 mi$/, '') : 'Loading stadium'}</h1>
          <p>
            {loaded?.map.theme ? (
              <span title={`Colours: ${loaded.map.theme.source}`}>{loaded.map.theme.team}</span>
            ) : (
              'Gameday Command'
            )}
            <button className="link" onClick={onChangeStadium}>
              Change stadium
            </button>
            {/* The dot scale, worked out from the crowd and the live frame, never typed. */}
            <span className="scale" title="How the crowd on the map is drawn: one dot per group of fans.">
              1 dot = {fansPerDot === null ? '…' : n(fansPerDot)} fans, {liveDots > 0 ? n(liveDots) : '…'} dots,{' '}
              {liveFans > 0 ? n(liveFans) : '…'} fans
            </span>
          </p>
        </div>
      </div>

      <nav className="situations" aria-label="Situation">
        {incidents.map((candidate, i) => (
          <button
            key={candidate.id}
            className={i === incidentIndex ? 'on' : undefined}
            onClick={() => onIncident(i)}
            aria-pressed={i === incidentIndex}
          >
            <strong>{INCIDENT_LABELS[candidate.kind]}</strong>
            <span>{clockText(candidate.at)}</span>
          </button>
        ))}
      </nav>

      <div className="clock">
        <div className="clock-read">
          <strong>{clockText(t)}</strong>
          {status && <span className={`status ${status.phase}`}>{status.text}</span>}
        </div>
        <span className="progress">
          <i style={{ width: `${progress * 100}%` }} />
          {incident && (
            <b
              className="incident-mark"
              style={{ left: `${((incident.at - timeWindow.startAt) / (timeWindow.endAt - timeWindow.startAt)) * 100}%` }}
              title={`${INCIDENT_LABELS[incident.kind]} ${minutes(incident.at)} from kickoff`}
            />
          )}
        </span>
      </div>
      <div className="role-switch">
        <span>{officerRole ? (own?.unit ?? policeCopy.officer) : policeCopy.supervisor}</span>
        <button onClick={onRole}>{policeCopy.switchRole}</button>
      </div>
      <ThemeToggle />
    </header>
  );
}
