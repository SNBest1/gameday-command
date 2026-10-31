import { useState } from 'react';
import type { Incident, MapBundle, ResponsePlan, Scorecard } from '../../contracts.ts';
import { DANGER, n } from './app-config.ts';
import { Info } from './Info.tsx';
import { describeAction, PlanEditor } from './PlanEditor.tsx';
import { stepStatus } from './live-steps.ts';
import { liveRows, resultRows } from './scoreboard.ts';
import { clearText, liveStats } from './story.ts';
import type { RunHandle } from './useRun.ts';

export interface PlanState {
  plan: ResponsePlan;
  disabled: Set<number>;
}

/** A, B and C in one table: live while they run, results once all three finish. */
export function PlanScoreboard({
  runs,
  map,
  incident,
  labels,
  cards,
  allDone,
}: {
  runs: RunHandle[];
  map: MapBundle;
  incident: Incident;
  labels: readonly string[];
  cards: (Scorecard | null)[];
  allDone: boolean;
}) {
  const rows = allDone
    ? resultRows(cards.filter((c): c is Scorecard => c !== null))
    : liveRows(
        runs.map((run) =>
          liveStats(
            run.latest.current?.density?.peoplePerM2,
            incident.cells,
            DANGER,
            run.latest.current?.frame,
            map.width,
          ),
        ),
      );
  return (
    <table className="scoreboard" aria-label={allDone ? 'Results for each plan' : 'Each plan right now'}>
      <thead>
        <tr>
          <th scope="col">{allDone ? 'Result' : 'Right now'}</th>
          {labels.map((l) => (
            <th key={l} scope="col">
              <span className="label">{l}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <th scope="row" title={r.hint}>
              {r.label}
            </th>
            {r.cells.map((c, i) => (
              <td key={i} className={r.best === i ? 'best' : undefined}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Copies the comparison as text; says so for a moment. */
export function CopySummary({ text }: { text: () => string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="small copy-summary"
      onClick={() => {
        navigator.clipboard
          ?.writeText(text())
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          })
          .catch(() => setCopied(false));
      }}
    >
      {copied ? 'Copied' : 'Copy summary'}
    </button>
  );
}

export function PlanCard({
  label,
  state,
  run,
  map,
  incident,
  totalFans,
  selected,
  rank,
  onSelect,
  onEdit,
}: {
  label: string;
  state: PlanState;
  run: RunHandle;
  map: MapBundle;
  incident: Incident;
  totalFans: number;
  selected: boolean;
  rank: number | null;
  onSelect: () => void;
  onEdit: (plan: ResponsePlan, disabled: Set<number>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const live = liveStats(
    run.latest.current?.density?.peoplePerM2,
    incident.cells,
    DANGER,
    run.latest.current?.frame,
    map.width,
  );
  const alerts = state.plan.actions.some((a, i) => a.type === 'alert' && !state.disabled.has(i));
  const officers = state.plan.actions.some((a, i) => a.type === 'send_officers' && !state.disabled.has(i));
  const card = run.scorecard;
  const steps = state.plan.actions.map((action, i) => ({ action, i })).filter(({ i }) => !state.disabled.has(i));
  const started = run.t >= incident.at;

  return (
    <section className={`plan-card${selected ? ' selected' : ''}${rank === 0 ? ' best' : ''}`} onClick={onSelect}>
      <header>
        <span className="label">{label}</span>
        <h3>{state.plan.name}</h3>
        {rank === 0 && <span className="badge best">Best plan</span>}
        {selected && rank !== 0 && <span className="badge">on map</span>}
      </header>

      <ol className="plan-steps">
        {steps.length === 0 && <li className="muted">Does nothing. A baseline to compare against.</li>}
        {steps.map(({ action, i }) => {
          const done = run.t >= incident.at + action.at;
          const status = stepStatus(
            action,
            incident.at + action.at,
            run.t,
            run.scene.current,
            run.alerts.current ?? [],
            map,
          );
          return (
            <li key={i} className={done ? 'done' : undefined}>
              <span className="tick">{done ? '✓' : ''}</span>
              {describeAction(action, map)}
              {action.at > 0 && <span className="muted"> after {Math.round(action.at / 60) || '<1'} min</span>}
              {status && <span className={`live ${action.type}`}>{status}</span>}
            </li>
          );
        })}
      </ol>

      {card ? (
        <dl className="results">
          <dt>
            Time to clear{' '}
            <Info>
              Minutes from the start of the incident until the crowd in the zone thinned out to safe levels. Lower is
              better.
            </Info>
          </dt>
          <dd className={card.timeToClearMin === null ? 'bad' : undefined}>{clearText(card)}</dd>
          {officers && (
            <>
              <dt>
                First officer on scene{' '}
                <Info>Minutes from the start of the incident until an officer reached the zone.</Info>
              </dt>
              <dd>{card.firstOfficerMin === null ? 'never' : `${card.firstOfficerMin.toFixed(1)} min`}</dd>
              <dt>
                Officer time used <Info>Officers committed, times how long. The staffing cost of the plan.</Info>
              </dt>
              <dd>{n(card.officerMinutesUsed)} min</dd>
            </>
          )}
          {card.vehicleDelayMin !== undefined && (
            <>
              <dt>
                Ambulance on scene{' '}
                <Info>
                  Minutes from the start of the incident until the ambulance, driving in from the edge of the map,
                  reached the zone. Crowds and closed streets slow it down.
                </Info>
              </dt>
              <dd className={card.emergencyResponseMin === null ? 'bad' : undefined}>
                {card.emergencyResponseMin == null ? 'never got there' : `${card.emergencyResponseMin.toFixed(1)} min`}
              </dd>
              <dt>
                Time stuck in traffic{' '}
                <Info>
                  Every vehicle's minutes spent stopped, added up: behind other cars, at a closure, or waiting for a
                  crowd to clear the road.
                </Info>
              </dt>
              <dd>{n(card.vehicleDelayMin)} vehicle-min</dd>
            </>
          )}
          {alerts && (
            <>
              <dt>
                Fans the alert reached <Info>How many fans actually got the PA announcement or phone alert.</Info>
              </dt>
              <dd>{n(Math.max(0, totalFans - card.fansNotReached))}</dd>
            </>
          )}
        </dl>
      ) : (
        <dl className="results">
          <dt>
            In the zone now <Info>People standing inside the yellow incident zone on the map right now.</Info>
          </dt>
          <dd>{run.ready ? n(live.zonePeople) : '…'}</dd>
          <dt>
            Dangerously packed{' '}
            <Info>
              People on their feet (not in a seat) anywhere on the map tighter than {DANGER} per m², where crowd crush
              becomes possible.
            </Info>
          </dt>
          <dd className={live.dangerPeople > 0 ? 'bad' : undefined}>{run.ready ? n(live.dangerPeople) : '…'}</dd>
          <dt className="muted">Result</dt>
          <dd className="muted">{started ? 'when the run ends' : 'after the incident'}</dd>
        </dl>
      )}

      <button
        className="link"
        onClick={(e) => {
          e.stopPropagation();
          setEditing((v) => !v);
        }}
      >
        {editing ? 'Done editing' : 'Edit this plan'}
      </button>
      {editing && (
        <div className="plan-edit" onClick={(e) => e.stopPropagation()}>
          <p className="muted">Switch steps off, or change when they happen and how many officers go.</p>
          <PlanEditor plan={state.plan} map={map} disabled={state.disabled} onChange={onEdit} />
        </div>
      )}
      {run.error && <p className="error">{run.error}</p>}
    </section>
  );
}
