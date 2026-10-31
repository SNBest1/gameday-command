import { useState } from 'react';
import type { OfficerStatus, PoliceOrder } from '../../engine/src/edits.ts';
import { policeCopy as c } from './police-copy.ts';
type ReportKind = Extract<PoliceOrder, { type: 'officer_report' }>['kind'];
export function OfficerConsole({
  officer,
  disabled,
  following,
  onFollow,
  onBackup,
  onReport,
  onAck,
  where,
  nearby,
}: {
  officer: OfficerStatus | undefined;
  disabled: boolean;
  following: boolean;
  onFollow: () => void;
  onBackup: () => void;
  onReport: (kind: ReportKind) => void;
  onAck: () => void;
  where?: string;
  nearby: { name: string; etaS: number }[];
}) {
  const [ack, setAck] = useState(''),
    [kind, setKind] = useState<ReportKind>('crowd crush');
  const key = officer?.mission
    ? `${officer.mission.startedAt}:${officer.mission.targetCell}`
    : (officer?.patrol?.name ?? 'standby');
  const state = officer?.state === 'standby' ? c.standby : (officer?.state.replaceAll('_', ' ') ?? '');
  return (
    <aside className="side officer-console">
      <div className="rail-body">
        <header className="oc-head">
          <h2>{officer?.unit ?? c.chooseUnit}</h2>
          {officer && <span className={`oc-state ${officer.state}`}>{officer.state.replaceAll('_', ' ')}</span>}
        </header>
        <section className="oc-card">
          <h3>{c.assignmentCard}</h3>
          <p className="oc-task">{officer?.mission?.reason || state}</p>
          {where && <p>Where: {where}</p>}
          {officer?.mission && (
            <p className="muted">
              {officer.mission.phase}
              {officer.etaS !== null ? `, walking ETA ${Math.ceil(officer.etaS / 60)} min` : ''}
            </p>
          )}
          {officer?.patrol && (
            <p className="muted">
              {officer.patrol.name}: waypoint {officer.patrol.index + 1} of {officer.patrol.waypoints.length}
            </p>
          )}
          <div className="police-actions">
            <button
              className="primary"
              disabled={!officer || ack === key}
              onClick={() => {
                setAck(key);
                onAck();
              }}
            >
              {ack === key ? c.acknowledged : c.acknowledge}
            </button>
            <button disabled aria-pressed={officer?.state === 'en_route'}>
              {c.enRoute}
            </button>
            <button disabled aria-pressed={officer?.state === 'on_scene'}>
              {c.onScene}
            </button>
          </div>
        </section>
        <section className="block">
          <div className="police-actions">
            <button disabled={disabled || !officer} onClick={onBackup}>
              {c.backup}
            </button>
            <button className="ghost" onClick={onFollow}>
              {following ? c.freeLook : c.backToMe}
            </button>
          </div>
          <div className="oc-report">
            <label>
              {c.report}
              <select value={kind} onChange={(e) => setKind(e.target.value as ReportKind)}>
                {c.reports.map((k) => (
                  <option key={k} value={k}>
                    {k[0]!.toUpperCase() + k.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={disabled || !officer} onClick={() => onReport(kind)}>
              {c.report}
            </button>
          </div>
        </section>
        <section className="block">
          <h3>{c.nearby}</h3>
          <ul className="oc-nearby">
            {nearby.map((v, i) => (
              <li key={i}>
                <span>{v.name}</span>
                <b>{Math.ceil(v.etaS / 60)} min</b>
              </li>
            ))}
          </ul>
        </section>
        <p className="muted oc-foot">
          {c.supervisorOnly} {c.sharedRole}
        </p>
      </div>
    </aside>
  );
}
