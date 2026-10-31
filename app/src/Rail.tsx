import type { Briefing, Incident, MapBundle, Scorecard, VehicleKind } from '../../contracts.ts';
import { DOT_GROUP_SIZE } from '../../contracts.ts';
import type { SceneInfo } from '../../engine/src/index.ts';
import { INCIDENT_LABELS } from '../../world/src/incidents.ts';
import { VEHICLE_TYPE_LIST } from '../../world/src/vehicles.ts';
import { weatherTimeline } from '../../world/src/weather.ts';
import { LABELS, n, SEED } from './app-config.ts';
import { CommandPanel, Ranking } from './CommandPanel.tsx';
import type { FocusBox } from './ComparisonMaps.tsx';
import type { HistorySample, Priority } from './command.ts';
import { GatesPanel } from './GatesPanel.tsx';
import { Info } from './Info.tsx';
import { CopySummary, PlanCard, PlanScoreboard, type PlanState } from './PlanCards.tsx';
import { pitchFor } from './pitch.ts';
import { PolicePanel, type PolicePickMode } from './PolicePanel.tsx';
import { OfficerRoster, ZoneTable, LotBoard } from './SideBoards.tsx';
import { Roadblocks } from './Roadblocks.tsx';
import { resultRows, summaryText } from './scoreboard.ts';
import { verdictText } from './story.ts';
import type { RunHandle } from './useRun.ts';
import { VehicleIcon } from './Legend.tsx';
import { HOTSPOT_COLOUR, type PoliceHotspot } from './congestion.ts';
import type { RailTabId } from './voice-intents.ts';

export interface RailProps {
  tab: RailTabId;
  onTab: (tab: RailTabId) => void;
  tabs: readonly { id: RailTabId; label: string }[];
  criticalCount: number;
  suggestionCount: number;
  allDone: boolean;
  loaded: { map: MapBundle } | null;
  incident: Incident | undefined;
  started: boolean;
  zoneName: string;
  planStates: PlanState[];
  runs: RunHandle[];
  closeRun: number;
  history: { runs: number; samples: HistorySample[] };
  view: 'ops' | 'close' | 'plan' | 'compare';
  setView: (view: 'ops' | 'close' | 'plan' | 'compare') => void;
  setCloseRun: (run: number) => void;
  setPlanStates: (next: PlanState[] | ((prev: PlanState[]) => PlanState[])) => void;
  setPlansDirty: (dirty: boolean) => void;
  restart: () => void;
  cards: (Scorecard | null)[];
  briefing: Briefing | null;
  briefingBusy: boolean;
  priority: Priority;
  setPriority: (priority: Priority) => void;
  rankOf: (index: number) => number | null;
  picked: { run: number; dot: number } | null;
  setPicked: (picked: { run: number; dot: number } | null) => void;
  plansDirty: boolean;
  fanCount: (map: MapBundle) => number;
  police: PoliceHotspot[][];
  generation: number;
  ordersDisabled: boolean;
  setFocusBox: (box: FocusBox) => void;
  armPick: (mode: PolicePickMode) => void;
  pickMode: PolicePickMode;
  pickHint: string | null;
  sendOrder: (order: import('../../engine/src/index.ts').PoliceOrder) => void;
  liveScene: SceneInfo | null;
  bands: import('./heat.ts').HeatBand[];
  traffic: boolean;
  showVehicles: boolean;
  setShowVehicles: (show: boolean) => void;
  vehicleFocus: VehicleKind | null;
  setVehicleFocus: (focus: VehicleKind | null) => void;
  vehicleCounts: Map<VehicleKind, number>;
  totalDecisions: number;
  guessed: number;
  kev: number;
  kevAnswers: number | null;
  weatherId: string;
}

export function Rail(props: RailProps) {
  const {
    tab,
    onTab,
    tabs,
    criticalCount,
    suggestionCount,
    allDone,
    loaded,
    incident,
    started,
    zoneName,
    planStates,
    runs,
    closeRun,
    history,
    view,
    setView,
    setCloseRun,
    setPlanStates,
    setPlansDirty,
    restart,
    cards,
    briefing,
    briefingBusy,
    priority,
    setPriority,
    rankOf,
    picked,
    setPicked,
    plansDirty,
    fanCount,
    police,
    generation,
    ordersDisabled,
    setFocusBox,
    armPick,
    pickMode,
    pickHint,
    sendOrder,
    liveScene,
    bands,
    traffic,
    showVehicles,
    setShowVehicles,
    vehicleFocus,
    setVehicleFocus,
    vehicleCounts,
    totalDecisions,
    guessed,
    kev,
    kevAnswers,
    weatherId,
  } = props;

  return (
    <aside className="side">
      <div className="rail-tabs" role="tablist" aria-label="Side panel">
        {tabs.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? 'on' : undefined}
            onClick={() => onTab(item.id)}
          >
            {item.label}
            {item.id === 'brief' && criticalCount > 0 && <b className="tab-count">{criticalCount}</b>}
            {item.id === 'orders' && suggestionCount > 0 && (
              <b className="tab-count info" title={`${suggestionCount} suggested responses`}>
                {suggestionCount}
              </b>
            )}
            {item.id === 'plans' && allDone && <b className="tab-dot" title="Results are in" />}
          </button>
        ))}
      </div>

      <div className="rail-body">
        {tab === 'brief' && (
          <>
            {incident && started && <p className="pitch">{pitchFor(incident, zoneName)}</p>}
            {loaded && incident && planStates.length === 3 && (
              <CommandPanel
                map={loaded.map}
                incident={incident}
                run={runs[closeRun]!}
                label={LABELS[closeRun]!}
                history={history}
                onSuggest={(plans) => {
                  if (plans.length < 3) return;
                  setPlanStates(plans.slice(0, 3).map((plan) => ({ plan, disabled: new Set<number>() })));
                  restart();
                  onTab('plans');
                }}
              />
            )}
            <section className="block police">
              <h2>
                Most congested now{' '}
                <Info>
                  Ranked by people standing packed at 3 or more per m² and by vehicles stopped or crawling. Seated fans
                  are left out: a full section is dense but safe. This ranks places to look at; where to send officers
                  stays your call.
                </Info>
              </h2>
              <div className="seg" role="group" aria-label="Plan">
                {LABELS.map((l, i) => (
                  <button
                    key={l}
                    className={closeRun === i ? 'on' : undefined}
                    onClick={() => {
                      setCloseRun(i);
                      if (view === 'compare') setView('plan');
                    }}
                  >
                    Plan {l}
                    {(police[i]?.filter((h) => h.level === 'critical').length ?? 0) > 0 && (
                      <b className="crit-count">{police[i]!.filter((h) => h.level === 'critical').length}</b>
                    )}
                  </button>
                ))}
              </div>
              {(police[closeRun] ?? []).length === 0 ? (
                <p className="muted">
                  {started ? 'Nothing congested at the moment.' : 'Run the plans to see where it gets congested.'}
                </p>
              ) : (
                <ol className="hotspots">
                  {(police[closeRun] ?? []).map((h) => (
                    <li key={h.rank} className={h.level}>
                      <button
                        onClick={() => setFocusBox({ x0: h.x0, y0: h.y0, x1: h.x1, y1: h.y1, nonce: Date.now() })}
                        title="Show on the map"
                      >
                        <span className="rank" style={{ background: HOTSPOT_COLOUR[h.level] }}>
                          {h.rank}
                        </span>
                        <span className="what">
                          <strong>{h.where}</strong>
                          <em>
                            {h.kind !== 'traffic' &&
                              `${n(h.crowdedPeople)} packed, peak ${h.peakDensity.toFixed(1)}/m²`}
                            {h.kind === 'both' && '; '}
                            {h.kind !== 'crowd' &&
                              `${h.stoppedVehicles} vehicles stopped${h.slowVehicles ? `, ${h.slowVehicles} slow` : ''}`}
                          </em>
                        </span>
                        <span className={`level ${h.level}`}>{h.level}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}

        {tab === 'plans' && (
          <>
            {loaded && incident && planStates.length === 3 && started && (
              <PlanScoreboard
                runs={runs}
                map={loaded.map}
                incident={incident}
                labels={LABELS}
                cards={cards}
                allDone={allDone}
              />
            )}
            <section className="block verdict">
              <h2>Comparison</h2>
              {/* Who wrote this, at the top: a template summary folded into grey
                      type under the text still read as if a model had written it. */}
              {allDone && briefing?.canned && (
                <p className="verdict-template">
                  Template briefing: the AI writer was not running, so this wording is fixed.
                </p>
              )}
              {!allDone && <p className="muted">Appears when all three plans finish.</p>}
              {allDone && incident && (
                <>
                  <p className="verdict-line">
                    {verdictText(
                      LABELS,
                      planStates.map((p) => p.plan.name),
                      cards.filter((c): c is Scorecard => c !== null),
                      zoneName,
                    )}
                  </p>
                  <CopySummary
                    text={() =>
                      summaryText(
                        `${loaded ? loaded.map.name.replace(/ \+ 0\.5 mi$/, '') : 'Stadium'}, ${INCIDENT_LABELS[incident.kind].toLowerCase()}`,
                        LABELS,
                        planStates.map((p) => p.plan.name),
                        verdictText(
                          LABELS,
                          planStates.map((p) => p.plan.name),
                          cards.filter((c): c is Scorecard => c !== null),
                          zoneName,
                        ),
                        resultRows(cards.filter((c): c is Scorecard => c !== null)),
                      )
                    }
                  />
                  {briefingBusy && <p className="muted">Writing the commander's briefing…</p>}
                  {briefing && (
                    <details className="briefing" open={!briefing.canned}>
                      <summary>{briefing.canned ? 'Full numbers for every plan' : "Commander's briefing"}</summary>
                      <p className="briefing-text">{briefing.text}</p>
                      <p className="muted">
                        {briefing.canned
                          ? 'Filled in from a template, because the on-device AI writer was not running.'
                          : 'Written by an on-device AI model. Every number in it is checked against the results.'}
                      </p>
                    </details>
                  )}
                </>
              )}
            </section>
            {loaded && incident && (
              <Ranking
                map={loaded.map}
                incident={incident}
                labels={LABELS}
                planNames={planStates.map((p) => p.plan.name)}
                cards={cards}
                allDone={allDone}
                priority={priority}
                onPriority={setPriority}
              />
            )}
            <section className="block">
              <h2>
                Three plans, same crowd{' '}
                <Info>
                  Click a plan to show it on the map. The plans differ only in what you tell the crowd and staff to do.
                </Info>
              </h2>
              {loaded &&
                incident &&
                planStates.map((state, i) => (
                  <PlanCard
                    key={state.plan.id}
                    label={LABELS[i]}
                    state={state}
                    run={runs[i]!}
                    map={loaded.map}
                    incident={incident}
                    totalFans={fanCount(loaded.map)}
                    selected={view !== 'compare' && closeRun === i}
                    rank={rankOf(i)}
                    onSelect={() => {
                      setCloseRun(i);
                      setView('close');
                      if (picked) setPicked({ run: i, dot: picked.dot });
                    }}
                    onEdit={(plan, disabled) => {
                      setPlanStates((prev) => prev.map((p, j) => (j === i ? { plan, disabled } : p)));
                      setPlansDirty(true);
                    }}
                  />
                ))}
              {plansDirty && (
                <button className="go wide" onClick={restart}>
                  Restart with my changes
                </button>
              )}
            </section>
          </>
        )}

        {tab === 'orders' && loaded && runs[closeRun] && (
          <section className="block">
            <h2>
              Police orders{' '}
              <Info>
                Give a live order to the plan on the map. It takes effect on the next simulated second; the other two
                plans continue as written.
              </Info>
            </h2>
            <PolicePanel
              hotspots={police[closeRun]}
              incident={incident}
              key={`${closeRun}-${generation}`}
              map={loaded.map}
              run={runs[closeRun]!}
              label={LABELS[closeRun]!}
              disabled={ordersDisabled}
              started={started}
              onFocus={(cell) =>
                setFocusBox({
                  x0: (cell % loaded!.map.width) - 15,
                  y0: Math.floor(cell / loaded!.map.width) - 15,
                  x1: (cell % loaded!.map.width) + 15,
                  y1: Math.floor(cell / loaded!.map.width) + 15,
                  nonce: Date.now(),
                })
              }
              onOrder={sendOrder}
              armPick={armPick}
              pickMode={pickMode}
              hint={pickHint}
            />
          </section>
        )}
        {tab === 'orders' && loaded && runs[closeRun] && <OfficerRoster map={loaded.map} run={runs[closeRun]!} />}

        {tab === 'gates' && loaded && runs[closeRun] && (
          <section className="block">
            <h2>
              Gates for plan {LABELS[closeRun]}{' '}
              <Info>
                Every gate's door and flow for the plan on the map: people through it per minute in and out, the queue
                waiting, and how much of what it can pass it is passing. A closed gate passes nobody and turns its queue
                away to the next open gate.
              </Info>
            </h2>
            <GatesPanel
              map={loaded.map}
              run={runs[closeRun]!}
              label={LABELS[closeRun]!}
              onToggle={(closableId, closed) => sendOrder({ type: 'gate', closableId, closed })}
              disabled={ordersDisabled}
            />
          </section>
        )}
        {tab === 'gates' && loaded && runs[closeRun] && <ZoneTable map={loaded.map} run={runs[closeRun]!} />}
        {tab === 'gates' && loaded && runs[closeRun] && <LotBoard map={loaded.map} run={runs[closeRun]!} />}

        {tab === 'key' && (
          <>
            {loaded && (
              <Roadblocks
                map={loaded.map}
                scene={liveScene}
                vehicles={runs[closeRun]!.latest.current?.frame.vehicles}
                onFocus={(cell) =>
                  setFocusBox({
                    x0: (cell % loaded.map.width) - 15,
                    y0: Math.floor(cell / loaded.map.width) - 15,
                    x1: (cell % loaded.map.width) + 15,
                    y1: Math.floor(cell / loaded.map.width) + 15,
                    nonce: Date.now(),
                  })
                }
              />
            )}
            <section className="block">
              <h2>How packed</h2>
              <ul className="band-key">
                {bands.map((band) => (
                  <li key={band.id}>
                    <i style={{ background: `rgb(${band.rgb.join(',')})` }} />
                    <span>
                      <strong>{band.label}</strong> {band.range}
                      <em>{band.note}</em>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="muted">Click a colour under the map to see every area at that level.</p>
            </section>
            {traffic && (
              <section className="block">
                <h2>Traffic on the roads</h2>
                <ul className="band-key">
                  <li>
                    <i style={{ background: '#2ed573' }} />
                    <span>
                      <strong>Moving</strong> 13 mph or faster
                    </span>
                  </li>
                  <li>
                    <i style={{ background: '#ffb020' }} />
                    <span>
                      <strong>Slow</strong> 3 to 13 mph
                    </span>
                  </li>
                  <li>
                    <i style={{ background: '#ff3040' }} />
                    <span>
                      <strong>Jammed</strong> stopped or crawling
                    </span>
                  </li>
                </ul>
              </section>
            )}
            {traffic && (
              <section className="block vehicles-panel">
                <h2>
                  Vehicles
                  <label className="toggle">
                    <input type="checkbox" checked={showVehicles} onChange={(e) => setShowVehicles(e.target.checked)} />{' '}
                    Show on map
                  </label>
                </h2>
                <p className="muted">Real sizes, drawn to scale. Click a type to pick it out on the map.</p>
                <div className="vehicle-grid">
                  {VEHICLE_TYPE_LIST.map((type) => (
                    <button
                      key={type.kind}
                      className={`vehicle-chip${vehicleFocus === type.kind ? ' on' : ''}${vehicleFocus !== null && vehicleFocus !== type.kind ? ' off' : ''}`}
                      onClick={() => setVehicleFocus(vehicleFocus === type.kind ? null : type.kind)}
                    >
                      <VehicleIcon kind={type.kind} />
                      <span className="vehicle-name">{type.label}</span>
                      <span className="vehicle-size">
                        {type.lengthM.toFixed(1)} × {type.widthM.toFixed(1)} m, {type.passengers} aboard
                      </span>
                      <span className="vehicle-count">
                        {(vehicleCounts.get(type.kind) ?? 0).toLocaleString()} on the map
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {tab === 'about' && (
          <section className="block tech">
            <h2>How the AI and the numbers work</h2>
            <p>
              {loaded ? fanCount(loaded.map).toLocaleString() : ''} fans are simulated as{' '}
              {loaded ? (fanCount(loaded.map) / DOT_GROUP_SIZE).toLocaleString() : ''} groups of {DOT_GROUP_SIZE},
              walking a real OpenStreetMap model of{' '}
              {loaded ? loaded.map.name.replace(/ \+ 0\.5 mi$/, '') : 'the stadium'} at 2 m resolution. When a group has
              to choose (shelter or run to the car? follow the officer?), an AI model called Kev gives the odds of each
              choice for that kind of fan.
            </p>
            <dl className="detail">
              <dt>Fan choices made</dt>
              <dd>{totalDecisions.toLocaleString()}</dd>
              <dt>Answered by the AI</dt>
              <dd>
                {(totalDecisions - guessed).toLocaleString()}
                {kev > 0 && <span className="muted"> ({kev.toLocaleString()} live)</span>}
              </dd>
              <dt>Guessed from defaults</dt>
              <dd className={guessed > 0 ? 'warn' : undefined}>{guessed.toLocaleString()}</dd>
              {kevAnswers !== null && (
                <>
                  <dt>Kev answers on file</dt>
                  <dd title="Decisions the Kev model has already given, cached so runs need not wait for it">
                    {kevAnswers.toLocaleString()}
                  </dd>
                </>
              )}
              {cards.some((c) => c) && (
                <>
                  <dt>Crush-risk cell minutes</dt>
                  <dd>{cards.map((c, i) => `${LABELS[i]} ${c ? n(c.dangerMinutes) : '…'}`).join(', ')}</dd>
                  <dt>Most packed spot</dt>
                  <dd>{cards.map((c, i) => `${LABELS[i]} ${c ? c.peakDensity.toFixed(1) : '…'}/m²`).join(', ')}</dd>
                </>
              )}
              {cards.some((c) => c?.vehicleDelayMin !== undefined) && (
                <>
                  <dt>Vehicles that drove off</dt>
                  <dd>{cards.map((c, i) => `${LABELS[i]} ${c ? n(c.vehiclesOut ?? 0) : '…'}`).join(', ')}</dd>
                  <dt>Most stopped at once</dt>
                  <dd>{cards.map((c, i) => `${LABELS[i]} ${c ? n(c.peakVehiclesStopped ?? 0) : '…'}`).join(', ')}</dd>
                </>
              )}
              <dt>Weather</dt>
              <dd>{weatherTimeline(weatherId).label}, the same for all three</dd>
              <dt>Random seed</dt>
              <dd>{SEED}, the same for all three</dd>
            </dl>
            <p className="muted">
              Fan behaviour, traffic and weather are an assumption, not a forecast. The tool shows the tradeoffs between
              plans. The commander makes the call.
            </p>
          </section>
        )}
      </div>
    </aside>
  );
}
