import type { Briefing, Incident, MapBundle, VehicleKind } from '../../contracts.ts';
import { CELL_SIZE_M } from '../../contracts.ts';
import { FAN_TYPES } from '../../brain/src/fan-types.ts';
import type { PoliceOrder } from '../../engine/src/index.ts';
import { INCIDENT_LABELS } from '../../world/src/incidents.ts';
import { VEHICLE_TYPES } from '../../world/src/vehicles.ts';
import { AlertBanner } from './AlertBanner.tsx';
import { DANGER, LABELS, n } from './app-config.ts';
import { ComparisonMaps, type FocusBox, type MapPick } from './ComparisonMaps.tsx';
import type { PoliceHotspot } from './congestion.ts';
import { CrowdView } from './CrowdView.tsx';
import { wallClock } from './dayclock.ts';
import type { BandTotals, HeatBand, Hotspot } from './heat.ts';
import { Inspector, type EditRequest } from './Inspector.tsx';
import { Legend, VehicleIcon } from './Legend.tsx';
import { OfficerPanel } from './OfficerPanel.tsx';
import { OpsMap } from './OpsMap.tsx';
import { applyDisabled } from './PlanEditor.tsx';
import type { PlanState } from './PlanCards.tsx';
import { pitchFor } from './pitch.ts';
import type { PolicePickMode } from './PolicePanel.tsx';
import type { DemoRole } from './roles.ts';
import { clockText } from './story.ts';
import type { RunHandle } from './useRun.ts';

type VehicleInfo = {
  type: (typeof VEHICLE_TYPES)[VehicleKind];
  state: string;
  speed: number;
  waited: number;
};

export interface MapWorkspaceProps {
  loaded: { map: MapBundle };
  runs: RunHandle[];
  closeRun: number;
  setCloseRun: (run: number) => void;
  planStates: PlanState[];
  incident: Incident | undefined;
  view: 'ops' | 'close' | 'plan' | 'compare';
  setView: (view: 'ops' | 'close' | 'plan' | 'compare') => void;
  showCoverage: boolean;
  showFlow: boolean;
  setShowFlow: (value: boolean | ((value: boolean) => boolean)) => void;
  playing: boolean;
  setPlaying: (playing: boolean) => void;
  started: boolean;
  zoneName: string;
  scrub: number | null;
  setScrub: (scrub: number | null) => void;
  scrubT: number | undefined;
  t: number;
  maxFrames: number;
  deciding: number;
  police: PoliceHotspot[][];
  selectedBand: number | null;
  setSelectedBand: (band: number | null) => void;
  bands: HeatBand[];
  totals: (BandTotals[] | null)[];
  spots: (Hotspot[] | null)[];
  zoomTo: (hotspot: Hotspot) => void;
  showVehicles: boolean;
  vehicleFocus: VehicleKind | null;
  focusBox: FocusBox | null;
  mapPicked: MapPick | null;
  picked: { run: number; dot: number } | null;
  setPicked: (picked: { run: number; dot: number } | null) => void;
  pickedOfficer: { run: number; id: string } | null;
  setPickedOfficer: (picked: { run: number; id: string } | null) => void;
  pickedVehicle: { run: number; vehicle: number } | null;
  setPickedVehicle: (picked: { run: number; vehicle: number } | null) => void;
  pickedCell: Extract<MapPick, { type: 'cell' }> | null;
  setPickedCell: (picked: Extract<MapPick, { type: 'cell' }> | null) => void;
  vehicleInfo: VehicleInfo | null;
  placeIndex: { describe(cell: number): string } | null;
  officerRole: boolean;
  roleChoice: DemoRole;
  focusToken: number;
  setFocusToken: (updater: (token: number) => number) => void;
  appliedNote: string | null;
  applyEdit: (edit: EditRequest) => void;
  ordersDisabled: boolean;
  pickMode: PolicePickMode;
  orderAt: (cell: number) => void;
  armPick: (mode: PolicePickMode) => void;
  sendOrder: (order: PoliceOrder) => void;
  traffic: boolean;
  setBriefing: (briefing: Briefing | null) => void;
  setSavedComparison: (id: string | null) => void;
}

export function MapWorkspace(props: MapWorkspaceProps) {
  const {
    loaded,
    runs,
    closeRun,
    setCloseRun,
    planStates,
    incident,
    view,
    setView,
    showCoverage,
    showFlow,
    setShowFlow,
    playing,
    setPlaying,
    started,
    zoneName,
    scrub,
    setScrub,
    scrubT,
    t,
    maxFrames,
    deciding,
    police,
    selectedBand,
    setSelectedBand,
    bands,
    totals,
    spots,
    zoomTo,
    showVehicles,
    vehicleFocus,
    focusBox,
    mapPicked,
    picked,
    setPicked,
    pickedOfficer,
    setPickedOfficer,
    pickedVehicle,
    setPickedVehicle,
    pickedCell,
    setPickedCell,
    vehicleInfo,
    placeIndex,
    officerRole,
    roleChoice,
    focusToken,
    setFocusToken,
    appliedNote,
    applyEdit,
    ordersDisabled,
    pickMode,
    orderAt,
    armPick,
    sendOrder,
    traffic,
    setBriefing,
    setSavedComparison,
  } = props;
  const pickedRun = picked ? runs[picked.run] : undefined;

  return (
    <>
      <div
        className={`canvas-wrap${view === 'ops' ? ' ops' : view === 'close' ? ' close' : view === 'plan' ? ' plan' : ''}`}
      >
        {/* Only one of these is mounted at a time, so the page holds a
                    single WebGL context. ComparisonMaps draws all three runs in
                    one PixiJS Application for the same reason. */}
        {view === 'ops' ? (
          <OpsMap
            showCoverage={showCoverage}
            officerFocus={officerRole ? roleChoice.unitId : null}
            map={loaded.map}
            run={runs[closeRun]!}
            types={FAN_TYPES}
            scrubIndex={scrub}
            dangerDensity={DANGER}
            incidentCells={incident?.cells}
            incidentLabel={incident ? `${INCIDENT_LABELS[incident.kind]} here` : undefined}
            selected={picked?.run === closeRun ? picked.dot : null}
            onPick={(dot) => {
              setPickedOfficer(null);
              setPickedVehicle(null);
              setPicked(dot === null ? null : { run: closeRun, dot });
            }}
            selectedOfficer={
              officerRole ? roleChoice.unitId : pickedOfficer?.run === closeRun ? pickedOfficer.id : null
            }
            onPickOfficer={(id) => {
              setPicked(null);
              setPickedVehicle(null);
              setPickedOfficer({ run: closeRun, id });
            }}
            focusToken={focusToken}
            showVehicles={showVehicles}
            vehicleFocus={vehicleFocus}
            selectedVehicle={pickedVehicle?.run === closeRun ? pickedVehicle.vehicle : null}
            onPickVehicle={(vehicle) => {
              setPicked(null);
              setPickedOfficer(null);
              setPickedVehicle({ run: closeRun, vehicle });
            }}
            selectedBand={selectedBand}
            focusBox={focusBox}
            showFlow={showFlow}
            onShowFlow={setShowFlow}
            hotspots={police[closeRun] ?? []}
            onPickStreet={pickMode ? orderAt : undefined}
          />
        ) : view !== 'close' ? (
          <ComparisonMaps
            showCoverage={showCoverage}
            key={view}
            map={loaded.map}
            runs={view === 'plan' ? [runs[closeRun]!] : runs}
            showFlow={showFlow}
            hotspots={view === 'plan' ? [police[closeRun] ?? []] : police}
            scrubIndex={scrub}
            dangerDensity={DANGER}
            incidentCells={incident?.cells}
            playing={playing}
            selectedBand={selectedBand}
            vehicleFocus={vehicleFocus}
            showVehicles={showVehicles}
            picked={
              view === 'plan' ? (mapPicked && mapPicked.run === closeRun ? { ...mapPicked, run: 0 } : null) : mapPicked
            }
            focus={focusBox}
            onPick={(raw) => {
              // The 2D plan has one panel; its index 0 is the plan on show.
              const pick = raw && view === 'plan' ? { ...raw, run: closeRun } : raw;
              if (pickMode && pick?.type === 'cell') {
                orderAt(pick.cell);
                return;
              }
              setPicked(pick?.type === 'dot' ? { run: pick.run, dot: pick.dot } : null);
              setPickedVehicle(pick?.type === 'vehicle' ? { run: pick.run, vehicle: pick.vehicle } : null);
              setPickedCell(pick?.type === 'cell' ? pick : null);
              if (pick?.type === 'cell') setSelectedBand(pick.band);
            }}
          />
        ) : (
          <CrowdView
            showCoverage={showCoverage}
            map={loaded.map}
            run={runs[closeRun]!}
            types={FAN_TYPES}
            scrubIndex={scrub}
            dangerDensity={DANGER}
            incidentCells={incident?.cells}
            incidentLabel={incident ? `${INCIDENT_LABELS[incident.kind]} here` : undefined}
            selected={picked?.run === closeRun ? picked.dot : null}
            onPick={(dot) => {
              setPickedOfficer(null);
              setPickedVehicle(null);
              setPicked(dot === null ? null : { run: closeRun, dot });
            }}
            selectedOfficer={
              officerRole ? roleChoice.unitId : pickedOfficer?.run === closeRun ? pickedOfficer.id : null
            }
            officerFocus={officerRole ? roleChoice.unitId : null}
            onPickOfficer={(id) => {
              setPicked(null);
              setPickedVehicle(null);
              setPickedOfficer({ run: closeRun, id });
            }}
            focusToken={focusToken}
            showVehicles={showVehicles}
            vehicleFocus={vehicleFocus}
            selectedVehicle={pickedVehicle?.run === closeRun ? pickedVehicle.vehicle : null}
            onPickVehicle={(vehicle) => {
              setPicked(null);
              setPickedOfficer(null);
              setPickedVehicle({ run: closeRun, vehicle });
            }}
            selectedBand={selectedBand}
            focusBox={focusBox}
            showFlow={showFlow}
            onShowFlow={setShowFlow}
            hotspots={police[closeRun] ?? []}
            onPickStreet={pickMode ? orderAt : undefined}
          />
        )}
        <div className="map-title">
          {view !== 'compare' ? (
            <>
              <span className="plan-switch" role="group" aria-label="Plan on the map">
                {LABELS.map((l, k) => (
                  <button
                    key={l}
                    className={closeRun === k ? 'on' : undefined}
                    aria-pressed={closeRun === k}
                    title={planStates[k]?.plan.name}
                    onClick={() => {
                      setCloseRun(k);
                      if (picked) setPicked({ run: k, dot: picked.dot });
                    }}
                  >
                    {l}
                  </button>
                ))}
              </span>
              <span className="map-plan-name">{planStates[closeRun]?.plan.name}</span>
            </>
          ) : (
            'Plans A, B and C side by side'
          )}
        </div>
        <div className="view-toggle">
          <button className={view === 'ops' ? 'on' : undefined} onClick={() => setView('ops')}>
            Map
          </button>
          <button className={view === 'close' ? 'on' : undefined} onClick={() => setView('close')}>
            Close-up
          </button>
          <button className={view === 'compare' ? 'on' : undefined} onClick={() => setView('compare')}>
            Side by side
          </button>
        </div>
        {deciding > 0 && (
          <div className="deciding">
            Kev is deciding what {deciding.toLocaleString()} groups of fans do. The clock waits.
          </div>
        )}
        {scrub !== null && <div className="replaying">Replay</div>}
        {pickMode && !ordersDisabled && (
          <div className="police-pick" role="status">
            {pickMode.kind === 'barricade'
              ? 'Click a street to barricade it — Esc to cancel'
              : pickMode.kind === 'marker'
                ? 'Click an outdoor location for the marker. Esc cancels.'
                : pickMode.kind === 'officer_report'
                  ? 'Click the incident location. Esc cancels.'
                  : pickMode.kind === 'add_officer'
                    ? 'Click an outdoor spot for the synthetic unit. Esc cancels.'
                    : pickMode.kind === 'traffic_point'
                      ? 'Click a junction for the traffic control point. Esc cancels.'
                      : `Click where to send ${pickMode.officerIds.length} ${pickMode.officerIds.length === 1 ? 'officer' : 'officers'} — Esc to cancel`}
            <span>Plan {LABELS[closeRun]} only</span>
          </div>
        )}
        {view === 'close' && <Legend />}
        {view === 'close' && runs[closeRun] && planStates[closeRun] && (
          <AlertBanner
            run={runs[closeRun]!}
            plan={applyDisabled(planStates[closeRun]!.plan, planStates[closeRun]!.disabled)}
            incidentAt={incident?.at ?? 0}
          />
        )}
        {!officerRole && pickedOfficer && runs[pickedOfficer.run] && (
          <OfficerPanel
            map={loaded.map}
            run={runs[pickedOfficer.run]!}
            label={LABELS[pickedOfficer.run]!}
            officerId={pickedOfficer.id}
            onClose={() => setPickedOfficer(null)}
            onSendTo={
              pickedOfficer.run === closeRun
                ? () => armPick({ kind: 'dispatch', officerIds: [pickedOfficer.id] })
                : undefined
            }
            onRecall={
              pickedOfficer.run === closeRun
                ? () => sendOrder({ type: 'recall', officerIds: [pickedOfficer.id] })
                : undefined
            }
            disabled={ordersDisabled}
          />
        )}
        {!officerRole && picked && pickedRun && (
          <Inspector
            map={loaded.map}
            types={FAN_TYPES}
            run={pickedRun}
            label={LABELS[picked.run]}
            dot={picked.dot}
            scrubbing={scrub !== null}
            appliedNote={appliedNote}
            onApply={applyEdit}
            onFocus={() => {
              setCloseRun(picked.run);
              if (view !== 'ops') setView('close');
              setFocusToken((k) => k + 1);
            }}
            onClose={() => setPicked(null)}
          />
        )}
        {pickedVehicle && vehicleInfo && (
          <VehicleInspector
            vehicleInfo={vehicleInfo}
            pickedVehicle={pickedVehicle}
            onClose={() => setPickedVehicle(null)}
          />
        )}
        {pickedCell && placeIndex && !picked && !pickedVehicle && (
          <CellInspector
            pickedCell={pickedCell}
            bands={bands}
            placeIndex={placeIndex}
            onClose={() => setPickedCell(null)}
          />
        )}
        {!started && !picked && (
          <div className="map-cta">
            <p>{incident && pitchFor(incident, zoneName)}</p>
            <button className="primary" onClick={() => setPlaying(true)} disabled={!runs.every((r) => r.ready)}>
              Run all three plans
            </button>
            <span className="muted">
              Then scroll to zoom in and click any fan to see why they move. Or hold <kbd>Space</kbd> and say “run the
              plans”.
            </span>
          </div>
        )}
      </div>

      <div className="replay">
        <span className="replay-label">
          {wallClock(scrubT ?? t)} · {scrub === null ? 'Live' : clockText(scrubT ?? t)}
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(0, maxFrames - 1)}
          value={scrub ?? Math.max(0, maxFrames - 1)}
          disabled={maxFrames < 2}
          onChange={(e) => setScrub(Number(e.target.value))}
          aria-label="Replay"
        />
        {scrub === null ? (
          <span className="muted">Drag to look back</span>
        ) : (
          <>
            <button
              className="small"
              title="Rewind the simulations themselves to this moment and play on from here"
              onClick={() => {
                // Rewind the simulations themselves, not just the picture:
                // each worker restores its nearest checkpoint and steps
                // forward, so play resumes from this moment.
                const at = scrub;
                const frame = runs.map((r) => r.frames.current?.[at]).find((f) => f !== undefined);
                if (!frame) return;
                setPlaying(false);
                setBriefing(null);
                setSavedComparison(null);
                for (const run of runs) run.seekTo(frame.frame.t);
                setScrub(null);
              }}
            >
              Play on from here
            </button>
            <button onClick={() => setScrub(null)} className="small">
              Back to live
            </button>
          </>
        )}
      </div>

      <div className="band-bar">
        {traffic && (
          <button
            className={`flow-key${showFlow ? ' on' : ''}`}
            onClick={() => setShowFlow((v) => !v)}
            title="Show or hide traffic flow on the roads"
          >
            <span className="legend-title">Traffic</span>
            <span>
              <i style={{ background: '#2ed573' }} /> Moving
            </span>
            <span>
              <i style={{ background: '#ffb020' }} /> Slow
            </span>
            <span>
              <i style={{ background: '#ff3040' }} /> Jammed
            </span>
          </button>
        )}
        <span className="legend-title">How packed</span>
        {bands.map((band) => {
          const total = totals.reduce((sum, t) => sum + (t?.[band.id]?.people ?? 0), 0) / 3;
          return (
            <button
              key={band.id}
              className={`band-chip${selectedBand === band.id ? ' on' : ''}${selectedBand !== null && selectedBand !== band.id ? ' off' : ''}`}
              onClick={() => setSelectedBand(selectedBand === band.id ? null : band.id)}
              title={band.note}
            >
              <i style={{ background: `rgb(${band.rgb.join(',')})` }} />
              <span>
                <strong>{band.label}</strong>
                <em>{band.range}</em>
              </span>
              {total > 0 && <b>{n(total)}</b>}
            </button>
          );
        })}
      </div>

      {selectedBand !== null && (
        <section className="block areas-panel">
          <h2>
            Where it is {bands[selectedBand]!.label.toLowerCase()}{' '}
            <span className="muted-inline">{bands[selectedBand]!.range}, biggest areas per plan</span>
            <button className="small" onClick={() => setSelectedBand(null)}>
              Show all colours
            </button>
          </h2>
          <div className="spots">
            {spots.map((list, i) => (
              <div key={i} className="spot-col">
                <h3>
                  <span className="label">{LABELS[i]}</span>{' '}
                  {totals[i]
                    ? `${n(totals[i]![selectedBand]!.people)} people in ${n(totals[i]![selectedBand]!.cells * CELL_SIZE_M * CELL_SIZE_M)} m²`
                    : ''}
                </h3>
                {!list && <p className="muted">no frame yet</p>}
                {list && list.length === 0 && <p className="muted">none right now</p>}
                {list?.map((h, k) => (
                  <button key={k} className="spot" onClick={() => zoomTo(h)}>
                    <span className="where">{h.where}</span>
                    <span className="nums">
                      {n(h.people)} people, {n(h.cells * CELL_SIZE_M * CELL_SIZE_M)} m², peak {h.peak.toFixed(1)}/m²
                    </span>
                    <span className="go">Show</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function VehicleInspector({
  vehicleInfo,
  pickedVehicle,
  onClose,
}: {
  vehicleInfo: VehicleInfo;
  pickedVehicle: { run: number; vehicle: number };
  onClose: () => void;
}) {
  return (
    <aside className="inspector vehicle-inspector">
      <header>
        <div>
          <h3>{vehicleInfo.type.label}</h3>
          <p className="muted">
            Vehicle {pickedVehicle.vehicle}, plan {LABELS[pickedVehicle.run]}
          </p>
        </div>
        <button className="small ghost" onClick={onClose} title="Close">
          ✕
        </button>
      </header>
      <section>
        <VehicleIcon kind={vehicleInfo.type.kind} />
        <dl className="detail">
          <dt>doing</dt>
          <dd className={vehicleInfo.state === 'stopped' ? 'warn' : undefined}>
            {vehicleInfo.state.replace(/_/g, ' ')}
          </dd>
          <dt>speed</dt>
          <dd>{Math.round(vehicleInfo.speed * 2.237)} mph</dd>
          <dt>time stopped</dt>
          <dd>
            {vehicleInfo.waited < 60
              ? `${Math.round(vehicleInfo.waited)} s`
              : `${(vehicleInfo.waited / 60).toFixed(1)} min`}
          </dd>
          <dt>size</dt>
          <dd>
            {vehicleInfo.type.lengthM.toFixed(1)} m × {vehicleInfo.type.widthM.toFixed(1)} m
          </dd>
          <dt>aboard</dt>
          <dd>about {vehicleInfo.type.passengers}</dd>
        </dl>
      </section>
    </aside>
  );
}

function CellInspector({
  pickedCell,
  bands,
  placeIndex,
  onClose,
}: {
  pickedCell: Extract<MapPick, { type: 'cell' }>;
  bands: HeatBand[];
  placeIndex: { describe(cell: number): string };
  onClose: () => void;
}) {
  return (
    <aside className="inspector vehicle-inspector">
      <header>
        <span className="swatch" style={{ background: `rgb(${bands[pickedCell.band]!.rgb.join(',')})` }} />
        <div>
          <h3>{bands[pickedCell.band]!.label}</h3>
          <p className="muted">
            {bands[pickedCell.band]!.range}, plan {LABELS[pickedCell.run]}
          </p>
        </div>
        <button className="small ghost" onClick={onClose} title="Close">
          ✕
        </button>
      </header>
      <section>
        <p>
          <strong>{pickedCell.density.toFixed(2)} people/m²</strong> near {placeIndex.describe(pickedCell.cell)}
        </p>
        <p className="muted">
          {bands[pickedCell.band]!.note} Every area this colour is highlighted, and the list below the map shows where.
        </p>
      </section>
    </aside>
  );
}
