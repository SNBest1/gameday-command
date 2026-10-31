import { Roadblocks } from './Roadblocks.tsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  Briefing,
  DecisionDefaults,
  Incident,
  MapBundle,
  Scorecard,
  SimConfig,
  VehicleKind,
} from '../../contracts.ts';
import { CELL_SIZE_M, DOT_GROUP_SIZE, FRAME_EVERY_S, VEHICLE_KINDS, VEHICLE_STATES } from '../../contracts.ts';
import { FAN_TYPES, makePopulation } from '../../brain/src/fan-types.ts';
import { makeOfficers } from '../../world/src/officers.ts';
import { INCIDENT_LABELS, incidentsFor, windowFor } from '../../world/src/incidents.ts';
import { playbookFor } from '../../world/src/playbook.ts';
import { VEHICLE_TYPES, VEHICLE_TYPE_LIST } from '../../world/src/vehicles.ts';
import { WEATHER_LABELS, WEATHER_TIMELINES, weatherTimeline } from '../../world/src/weather.ts';
import type { PoliceOrder } from '../../engine/src/index.ts';
import {
  AUTORUN,
  DANGER,
  LABELS,
  MAP_PARAM,
  n,
  OFFICERS,
  params,
  SEED,
  SPEEDS,
  START_TRAFFIC,
  START_WEATHER,
  STADIUM_FANS,
  TEST_FANS,
} from './app-config.ts';
import { getDecisionDefaults, getMap, saveComparison } from './api.ts';
import { markSignedIn, signedInThisSession } from './session.ts';
import { pitchFor } from './pitch.ts';
import { Info } from './Info.tsx';
import { CopySummary, PlanCard, PlanScoreboard, type PlanState } from './PlanCards.tsx';
import { AlertBanner } from './AlertBanner.tsx';
import { Legend, VehicleIcon } from './Legend.tsx';
import { ComparisonMaps, type FocusBox, type MapPick } from './ComparisonMaps.tsx';
import { CrowdView } from './CrowdView.tsx';
import { Inspector, type EditRequest } from './Inspector.tsx';
import { applyDisabled } from './PlanEditor.tsx';
import { CommandPanel, Ranking } from './CommandPanel.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';
import { CommandBar } from './CommandBar.tsx';
import { resultRows, summaryText } from './scoreboard.ts';
import { lastUndoable } from './after-action.ts';
import { describeUndo } from './voice-answers.ts';
import { StartScreen } from './StartScreen.tsx';
import { applyTheme } from './theme.ts';
import { rankByPriority, type HistorySample, type Priority } from './command.ts';
import { OfficerPanel } from './OfficerPanel.tsx';
import { OfficerRoster, ZoneTable, LotBoard } from './SideBoards.tsx';
import { GatesPanel } from './GatesPanel.tsx';
import { trafficCapacity } from '../../engine/src/index.ts';
import { policeCopy } from './police-copy.ts';
import { responseTargets, dispatchSuggestions } from './suggestions.ts';
import { DemoAccess } from './DemoAccess.tsx';
import { OfficerConsole } from './OfficerConsole.tsx';
import { readRole, saveRole, type DemoRole } from './roles.ts';
import { PolicePanel, type PolicePickMode } from './PolicePanel.tsx';
import { barricadeAt, fenceAt } from './barricade.ts';
import { clockText, incidentStatus, rankPlans, verdictText } from './story.ts';
import { wallClock } from './dayclock.ts';
import { HOTSPOT_COLOUR, policeHotspots, standingDensity, type PoliceHotspot } from './congestion.ts';
import { bandTotals, heatBands, hotspots, makePlaceIndex, type Hotspot } from './heat.ts';
import { useRun, type RunHandle, type RunInit } from './useRun.ts';
import { useHistoryRecording } from './useHistoryRecording.ts';
import { useAutorun } from './useAutorun.ts';
import { useBriefing } from './useBriefing.ts';

/** A stadium's crowd is its capacity, up to the 100,000 the engine is sized for. */
const fanCount = (map: MapBundle) =>
  map.width > 200
    ? Math.min(
        STADIUM_FANS,
        Math.round((map.places.find((p) => p.kind === 'seating')?.capacity ?? STADIUM_FANS) / 5) * 5,
      )
    : TEST_FANS;
/** The test map is a gate wall and a lot with no streets between them. */
const hasRoads = (map: MapBundle) => trafficCapacity(map).entries > 0;
const minutes = (seconds: number) => `${seconds < 0 ? '−' : '+'}${Math.abs(Math.round(seconds / 60))} min`;

/** The side rail's tabs, in the order a commander works through them. */
const RAIL_TABS = [
  { id: 'brief', label: 'Brief' },
  { id: 'orders', label: 'Orders' },
  { id: 'plans', label: 'Plans' },
  { id: 'gates', label: 'Gates' },
  { id: 'key', label: 'Map key' },
  { id: 'about', label: 'About' },
] as const;
type RailTab = (typeof RAIL_TABS)[number]['id'];

interface Loaded {
  map: MapBundle;
  defaults: DecisionDefaults;
}

export function App() {
  const [roleChoice, setRoleChoice] = useState<DemoRole>(() => readRole());
  const [showRole, setShowRole] = useState(() => !AUTORUN && !signedInThisSession()),
    [following, setFollowing] = useState(true);
  const officerRole = roleChoice.role === 'officer';
  const [mapId, setMapId] = useState<string | null>(MAP_PARAM ?? (AUTORUN ? 'default' : null));
  const [priority, setPriority] = useState<Priority>('clear');
  const [history, setHistory] = useState<{ runs: number; samples: HistorySample[] }>({ runs: 0, samples: [] });
  const [showCoverage, setShowCoverage] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [incidentIndex, setIncidentIndex] = useState(0);
  const [planStates, setPlanStates] = useState<PlanState[]>([]);
  const [plansDirty, setPlansDirty] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [savedComparison, setSavedComparison] = useState<string | null>(null);
  const [speed, setSpeed] = useState(20);
  const [scrub, setScrub] = useState<number | null>(null);
  const [picked, setPicked] = useState<{ run: number; dot: number } | null>(null);
  /** An officer clicked on the close-up. One inspector at a time: picking either clears the other. */
  const [pickedOfficer, setPickedOfficer] = useState<{ run: number; id: string } | null>(null);
  const [pickedVehicle, setPickedVehicle] = useState<{ run: number; vehicle: number } | null>(null);
  const [pickedCell, setPickedCell] = useState<Extract<MapPick, { type: 'cell' }> | null>(null);
  const [weatherId, setWeatherId] = useState(START_WEATHER);
  const [trafficOn, setTrafficOn] = useState(START_TRAFFIC);
  const [showVehicles, setShowVehicles] = useState(true);
  const [vehicleFocus, setVehicleFocus] = useState<VehicleKind | null>(null);
  const [selectedBand, setSelectedBand] = useState<number | null>(null);
  const [focusBox, setFocusBox] = useState<FocusBox | null>(null);
  /** The 3D close-up of one plan (the default) or all three maps side by side. */
  /** The 3D close-up of one plan (the default), a large 2D plan of one, or all three maps side by side. */
  const [view, setView] = useState<'close' | 'plan' | 'compare'>(
    params.get('view') === 'compare' ? 'compare' : params.get('view') === 'plan' ? 'plan' : 'close',
  );
  const [showFlow, setShowFlow] = useState(true);
  const [closeRun, setCloseRun] = useState(0);
  const [pickMode, setPickMode] = useState<PolicePickMode>(null);
  const [pickHint, setPickHint] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [appliedNote, setAppliedNote] = useState<string | null>(null);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [briefingBusy, setBriefingBusy] = useState(false);
  /** The synthetic-data note is shown on every load until dismissed; it is not remembered. */
  const [showSynthetic, setShowSynthetic] = useState(true);
  const [railTab, setRailTabState] = useState<RailTab>(() => {
    try {
      const saved = localStorage.getItem('gd-rail-tab');
      return RAIL_TABS.some((t) => t.id === saved) ? (saved as RailTab) : 'brief';
    } catch {
      return 'brief';
    }
  });
  const setRailTab = (tab: RailTab) => {
    setRailTabState(tab);
    try {
      localStorage.setItem('gd-rail-tab', tab);
    } catch {
      // private window: the rail opens on Brief next time
    }
  };

  useEffect(() => {
    if (!mapId) return;
    setLoaded(null);
    void (async () => {
      try {
        const map = await getMap(mapId);
        const defaults = await getDecisionDefaults();
        setLoaded({ map, defaults });
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error));
      }
    })();
  }, [mapId]);

  // What "usual" means for this stadium: every past run's gate queues and stopped traffic.
  const loadHistory = (id: string) =>
    void fetch(`/api/history?map=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then(setHistory)
      .catch(() => {});
  useEffect(() => {
    if (loaded) loadHistory(loaded.map.id);
    // The whole app takes on the home team's colours; Ohio Stadium stays scarlet and grey.
    applyTheme(loaded?.map.theme);
  }, [loaded]);

  const incidents = useMemo<Incident[]>(() => (loaded ? incidentsFor(loaded.map) : []), [loaded]);
  const incident = incidents[incidentIndex];
  const zoneName =
    (incident?.placeId && loaded?.map.places.find((p) => p.id === incident.placeId)?.name) || 'the closed street';

  const restart = () => {
    setPlaying(false);
    setScrub(null);
    setBriefing(null);
    setPicked(null);
    setPickedOfficer(null);
    setPickedVehicle(null);
    setPickedCell(null);
    setSavedComparison(null);
    setPlansDirty(false);
    setGeneration((g) => g + 1);
  };

  const placeIndex = useMemo(() => (loaded ? makePlaceIndex(loaded.map) : null), [loaded]);
  const bands = useMemo(() => heatBands(DANGER), []);
  const traffic = trafficOn && !!loaded && hasRoads(loaded.map);

  // The sky and the traffic are part of the moment, not the plan: changing
  // either restarts all three runs on the same seed.
  const firstScenario = useRef(true);
  useEffect(() => {
    if (firstScenario.current) {
      firstScenario.current = false;
      return;
    }
    restart();
  }, [weatherId, trafficOn]);

  // Picking an incident loads its playbook as editable copies.
  useEffect(() => {
    if (!loaded || !incident) return;
    const plans = playbookFor(incident.kind, loaded.map).slice(0, 3);
    setPlanStates(plans.map((plan) => ({ plan, disabled: new Set<number>() })));
    restart();
  }, [loaded, incident]);

  const inits = useMemo<(RunInit | null)[]>(() => {
    if (!loaded || !incident || planStates.length === 0) return [null, null, null];
    const population = makePopulation(fanCount(loaded.map), SEED);
    const officers = makeOfficers(loaded.map, OFFICERS);
    const window = windowFor(incident);
    void generation; // a new generation means fresh workers on the same seed
    return LABELS.map((label, i) => {
      const state = planStates[i];
      if (!state) return null;
      const config: SimConfig = {
        runId: `run-${label}-${generation}`,
        label,
        seed: SEED,
        startAt: window.startAt,
        endAt: window.endAt,
        speed,
        dangerDensity: DANGER,
        mapId: loaded.map.id,
        incident,
        plan: applyDisabled(state.plan, state.disabled),
        officers,
        traffic: traffic
          ? { vehicles: trafficCapacity(loaded.map).vehicles, seed: SEED ^ 0x7a11c, emergencyResponse: true }
          : undefined,
        weather: weatherTimeline(weatherId),
      };
      return { config, map: loaded.map, population, defaults: loaded.defaults };
    });
    // speed is deliberately out of the dependency list: it is sent live below.
    // Plan edits wait for "Restart with my changes" rather than restarting mid-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, generation]);

  // Fixed count of hooks, one per comparison slot.
  const runA = useRun(inits[0] ?? null);
  const runB = useRun(inits[1] ?? null);
  const runC = useRun(inits[2] ?? null);
  const runs = [runA, runB, runC];

  useEffect(() => {
    for (const run of runs) {
      if (!run.ready) continue;
      run.send({ type: playing ? 'play' : 'pause' });
    }
  }, [playing, runA.ready, runB.ready, runC.ready]);

  useEffect(() => {
    for (const run of runs) if (run.ready) run.send({ type: 'speed', speed });
  }, [speed, runA.ready, runB.ready, runC.ready]);

  const cards = runs.map((r) => r.scorecard);
  const allDone = cards.every((c) => c !== null);
  useHistoryRecording({ loaded, runA, runB, runC, generation, allDone, loadHistory });
  useAutorun({
    autorun: AUTORUN,
    loaded,
    runA,
    runB,
    runC,
    runs,
    setPlaying,
    incidentKind: incident?.kind ?? null,
    weatherId,
    traffic,
    allDone,
    savedComparison,
    briefing,
  });
  useBriefing({
    allDone,
    incident,
    cards,
    planStates,
    briefing,
    briefingBusy,
    setBriefing,
    setBriefingBusy,
  });
  // When all three plans finish, show the verdict once; after that the rail stays where the commander puts it.
  const wasDone = useRef(false);
  useEffect(() => {
    if (allDone && !wasDone.current) setRailTab('plans');
    wasDone.current = allDone;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone]);
  // "Best" is best for the priority the commander picked.
  const order = allDone ? rankByPriority(cards, priority) : null;
  void rankPlans;
  const rankOf = (i: number) => (order ? order.indexOf(i) : null);

  // Keep the finished comparison, which is what POST /comparisons is for.
  useEffect(() => {
    if (!allDone || !incident || savedComparison) return;
    const scorecards = cards.filter((c): c is Scorecard => c !== null);
    void saveComparison(incident, scorecards)
      .then((r) => setSavedComparison(r.id))
      .catch(() => {});
  }, [allDone, incident, savedComparison, cards]);
  const maxFrames = Math.max(...runs.map((r) => r.frameCount), 0);

  const pickedRun = picked ? runs[picked.run] : undefined;

  // Ask the picked group's worker about them on every frame: the inspector
  // shows movement state (gate, admitted, edits) that a TickFrame does not carry.
  useEffect(() => {
    if (!picked || !pickedRun?.ready) return;
    pickedRun.send({ type: 'inspect', dot: picked.dot });
  }, [picked, pickedRun?.tick, pickedRun?.ready]);

  /**
   * An edit goes to all three workers for the same sim second, a little ahead
   * of whichever plan is furthest along, so none of them has passed it yet and
   * the three runs still differ only by their plans.
   */
  const applyEdit = (edit: EditRequest) => {
    if (!picked || officerRole) return;
    const frame = runs[picked.run]?.latest.current?.frame;
    if (!frame) return;
    let dots = [picked.dot];
    if (edit.radiusM > 0 && frame.x[picked.dot]! >= 0) {
      const x = frame.x[picked.dot]!;
      const y = frame.y[picked.dot]!;
      dots = [];
      for (let i = 0; i < frame.x.length; i++) {
        if (frame.x[i]! < 0) continue;
        if (Math.hypot(frame.x[i]! - x, frame.y[i]! - y) <= edit.radiusM) dots.push(i);
      }
    }
    const at = Math.max(...runs.map((r) => r.t)) + FRAME_EVERY_S * 2;
    for (const run of runs) run.send({ type: 'edit', edit: { at, dots, fanType: edit.fanType, sendTo: edit.sendTo } });
    setSavedComparison(null);
    setAppliedNote(
      `Queued for ${dots.length.toLocaleString()} ${dots.length === 1 ? 'group' : 'groups'} at ${minutes(at)} from kickoff.`,
    );
  };
  useEffect(() => setAppliedNote(null), [picked?.dot]);

  const t = Math.max(...runs.map((r) => r.t));
  const window_ = incident ? windowFor(incident) : { startAt: 0, endAt: 1 };
  const progress = Math.min(1, Math.max(0, (t - window_.startAt) / (window_.endAt - window_.startAt)));
  const status = incident ? incidentStatus(incident, t) : null;
  const started = runs.some((r) => r.frameCount > 1);
  const ordersDisabled = scrub !== null || !started || runs[closeRun]!.scorecard !== null;

  // A pending click must not follow the commander into a different plan or replay.
  useEffect(() => {
    setPickMode(null);
    setPickHint(null);
  }, [closeRun, generation, ordersDisabled]);

  useEffect(() => {
    if (!pickMode) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPickMode(null);
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [pickMode]);

  const sendOrder = (order: PoliceOrder) => {
    if (
      ordersDisabled ||
      (officerRole &&
        ((order.type !== 'officer_report' && order.type !== 'officer_ack') || order.officerId !== roleChoice.unitId))
    )
      return;
    runs[closeRun]!.send({ type: 'order', order });
  };

  const armPick = (mode: PolicePickMode) => {
    if (mode && (ordersDisabled || (officerRole && mode.kind !== 'officer_report'))) return;
    setPickMode(mode);
    setPickHint(null);
    if (mode) {
      setPicked(null);
      setPickedOfficer(null);
      setPickedVehicle(null);
      setPickedCell(null);
    }
  };

  const orderAt = (cell: number) => {
    if (!pickMode) return;
    if (ordersDisabled || !loaded) {
      setPickMode(null);
      return;
    }
    if (pickMode.kind === 'marker') {
      sendOrder({
        type: 'place_marker',
        marker: {
          id: 'marker-' + runs[closeRun]!.t + '-' + cell,
          cell,
          kind: pickMode.markerKind,
          name:
            pickMode.markerKind === 'pa'
              ? 'PA speaker'
              : pickMode.markerKind === 'medical'
                ? 'Medical tent'
                : 'Staging area',
          radiusCells: pickMode.radiusCells,
        },
      });
      setPickMode(null);
      return;
    }
    if (pickMode.kind === 'officer_report') {
      if (roleChoice.unitId)
        sendOrder({
          type: 'officer_report',
          reportId:
            roleChoice.unitId + ':' + runs[closeRun]!.t + ':' + (runs[closeRun]!.scene.current?.orders?.length ?? 0),
          officerId: roleChoice.unitId,
          toCell: cell,
          kind: pickMode.reportKind,
        });
      setPickMode(null);
      return;
    }
    if (pickMode.kind === 'add_officer') {
      setPickMode(null);
      sendOrder({ type: 'add_officer', unit: pickMode.unit, cell });
      return;
    }
    if (pickMode.kind === 'traffic_point') {
      setPickMode(null);
      sendOrder({
        type: 'respond',
        officerIds: pickMode.officerIds,
        toCell: cell,
        kind: 'traffic',
        reason: 'Manual traffic control point',
        returnAfterS: 300,
      });
      return;
    }
    if (pickMode.kind === 'response') {
      setPickMode(null);
      sendOrder({ ...pickMode.mission, toCell: cell });
      return;
    }
    if (pickMode.kind === 'dispatch') {
      setPickMode(null);
      sendOrder({ type: 'dispatch', officerIds: pickMode.officerIds, toCell: cell });
      return;
    }
    const barricade =
      pickMode.blocks === 'pedestrians' && loaded.map.cells[cell] === 'walk'
        ? fenceAt(loaded.map, cell, pickMode.reachM ?? 20)
        : barricadeAt(loaded.map, cell, pickMode.reachM ?? 20, !!pickMode.replaceId);
    // A miss keeps barricade mode on, so the commander just clicks again.
    if (!barricade) {
      setPickHint('That is not a street — click a road');
      return;
    }
    setPickMode(null);
    if (pickMode.replaceId) sendOrder({ type: 'barricade', closableId: pickMode.replaceId, closed: false });
    sendOrder({
      type: 'barricade',
      closableId: pickMode.replaceId ? barricade.closableId + '-' + runs[closeRun]!.t : barricade.closableId,
      closed: true,
      name: barricade.name,
      cells: barricade.existing && !pickMode.replaceId ? undefined : barricade.cells,
      blocks: pickMode.blocks,
    });
  };
  const deciding = runs.reduce((sum, r) => sum + (r.deciding ?? 0), 0);
  const scrubT =
    scrub !== null ? runs.map((r) => r.frames.current?.[scrub]?.frame.t).find((x) => x !== undefined) : undefined;
  const kev = runs.reduce((sum, r) => sum + r.kevCount, 0);
  const totalDecisions = runs.reduce((sum, r) => sum + r.decisionCount, 0);
  const guessed = runs.reduce((sum, r) => sum + r.fallbackCount, 0);

  /** The frame on screen for a run: the scrubbed one, or the latest. */
  const shown = (run: RunHandle) => {
    const kept = run.frames.current ?? [];
    return scrub === null ? run.latest.current : (kept[Math.min(scrub, kept.length - 1)] ?? run.latest.current);
  };
  const ticks = runs.map((r) => r.tick).join(',');
  // The dot scale on screen. The fan count comes from the map's crowd, the dot
  // count from the live frame's arrays, and the ratio from the two of them, so
  // the line can never drift from what the workers are actually drawing.
  const liveFans = loaded ? fanCount(loaded.map) : 0;
  const liveDots = runs[closeRun]!.latest.current?.frame.x.length ?? 0;
  const fansPerDot = liveDots > 0 ? Math.round(liveFans / liveDots) : null;
  // The sky actually on the map for the run being shown, from its latest frame.
  // The picker carries the scenario; a lightning delay overrides the scene after
  // the scenario was picked, so the header must not read "Clear" over a storm.
  // Null until the first frame, and nothing is rendered then.
  const shownWeather = runs[closeRun]!.latest.current?.frame.weather ?? null;
  const liveSky = shownWeather ? `${WEATHER_LABELS[shownWeather.kind]}, ${Math.round(shownWeather.tempC)}°C` : null;
  // People on their feet per run, which every colour and count below is built
  // from: seated fans are dense and safe, as in the scorecard's danger minutes.
  const standing = useMemo(
    () =>
      runs.map((run) => {
        const view = shown(run);
        return view?.density && loaded ? standingDensity(loaded.map, view.frame, view.density.peoplePerM2) : null;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ticks, scrub, loaded],
  );
  const totals = useMemo(() => standing.map((rho) => (rho ? bandTotals(rho, bands) : null)), [standing, bands]);
  const spots = useMemo<(Hotspot[] | null)[]>(() => {
    if (selectedBand === null || !loaded || !placeIndex) return [null, null, null];
    return standing.map((rho) => (rho ? hotspots(rho, loaded.map, bands[selectedBand]!, placeIndex, 4) : null));
  }, [standing, selectedBand, loaded, placeIndex, bands]);
  // The most congested places in each run, for the police list and the map pins.
  const police = useMemo<PoliceHotspot[][]>(() => {
    if (!loaded || !placeIndex) return [[], [], []];
    return runs.map((run, i) =>
      policeHotspots(loaded.map, standing[i] ?? undefined, shown(run)?.frame.vehicles, placeIndex, DANGER, 6),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standing, loaded, placeIndex]);

  const liveScene = runs[closeRun]!.scene.current;
  const suggestedTargets = loaded
    ? responseTargets(
        loaded.map,
        police[closeRun] ?? [],
        incident,
        liveScene?.t,
        runs[closeRun]!.latest.current?.frame.vehicles,
      )
    : [];
  const requests = (liveScene?.orders ?? [])
    .flatMap((e) => (e.order.type === 'officer_report' ? [e.order] : []))
    .filter(
      (e) =>
        !liveScene?.orders?.some(
          (d) => (d.order.type === 'respond' || d.order.type === 'report_decision') && d.order.reportId === e.reportId,
        ),
    );
  const own = liveScene?.officers.find((o) => o.id === roleChoice.unitId);
  const nearbyTargets =
    loaded && officerRole && own
      ? [
          ...loaded.map.places
            .filter((p) => p.kind === 'gate' && p.cells.length)
            .map((p) => ({ cell: p.cells[0]!, name: p.name })),
          ...(liveScene?.barricades ?? []).map((b) => ({ cell: b.cells[0]!, name: b.name })),
          ...suggestedTargets.map((v) => ({ cell: v.cell, name: v.spot.where })),
        ]
          .sort(
            (a, b) =>
              Math.hypot(
                (a.cell % loaded.map.width) - (own.cell % loaded.map.width),
                Math.floor(a.cell / loaded.map.width) - Math.floor(own.cell / loaded.map.width),
              ) -
              Math.hypot(
                (b.cell % loaded.map.width) - (own.cell % loaded.map.width),
                Math.floor(b.cell / loaded.map.width) - Math.floor(own.cell / loaded.map.width),
              ),
          )
          .slice(0, 8)
      : [];
  const responseKey = [
    ...new Set(
      officerRole
        ? nearbyTargets.map((v) => v.cell)
        : [...requests.map((e) => e.toCell), ...suggestedTargets.map((v) => v.cell)],
    ),
  ]
    .slice(0, 8)
    .join(',');
  useEffect(() => {
    if (runs[closeRun]!.ready)
      runs[closeRun]!.send({
        type: 'response_targets',
        cells: responseKey ? responseKey.split(',').map(Number) : [],
        officerId: officerRole ? (roleChoice.unitId ?? undefined) : undefined,
      });
  }, [responseKey, closeRun, generation, runs[closeRun]!.ready, officerRole, roleChoice.unitId]);
  const nearby = nearbyTargets
    .flatMap((v) => {
      const eta = liveScene?.responses
        ?.find((r) => r.cell === v.cell)
        ?.units.find((u) => u.id === roleChoice.unitId)?.etaS;
      return eta != null && eta <= 180 ? [{ name: v.name, etaS: eta }] : [];
    })
    .sort((a, b) => a.etaS - b.etaS);
  useEffect(() => {
    if (officerRole) {
      setView('close');
      setPicked(null);
      setPickedOfficer(null);
      setPickMode(null);
    }
  }, [officerRole]);
  useEffect(() => {
    if (officerRole && following && own && loaded)
      setFocusBox({
        x0: own.x / CELL_SIZE_M - 12,
        y0: own.y / CELL_SIZE_M - 12,
        x1: own.x / CELL_SIZE_M + 12,
        y1: own.y / CELL_SIZE_M + 12,
        nonce: Date.now(),
      });
  }, [officerRole, following, own?.x, own?.y, loaded]);
  useEffect(() => {
    if (officerRole && loaded && liveScene && !liveScene.officers.some((o) => o.id === roleChoice.unitId))
      setShowRole(true);
  }, [officerRole, loaded, liveScene?.officers.length, roleChoice.unitId]);
  const suggestionCount = loaded && liveScene ? dispatchSuggestions(loaded.map, suggestedTargets, liveScene).length : 0;

  const vehicleCounts = useMemo(() => {
    const counts = new Map<VehicleKind, number>();
    const v = shown(runs[view === 'compare' ? 0 : closeRun]!)?.frame.vehicles;
    if (!v) return counts;
    for (let i = 0; i < v.kind.length; i++) {
      const state = VEHICLE_STATES[v.state[i]!];
      if (state === 'gone' || state === 'waiting') continue;
      const kind = VEHICLE_KINDS[v.kind[i]!]!;
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticks, scrub, view, closeRun]);
  const vehicleInfo = (() => {
    if (!pickedVehicle) return null;
    const v = shown(runs[pickedVehicle.run]!)?.frame.vehicles;
    if (!v) return null;
    const i = pickedVehicle.vehicle;
    return {
      type: VEHICLE_TYPES[VEHICLE_KINDS[v.kind[i]!]!],
      state: VEHICLE_STATES[v.state[i]!]!,
      speed: v.speed[i]!,
      waited: v.waitedS[i]!,
    };
  })();
  const mapPicked: MapPick | null = pickedVehicle
    ? { type: 'vehicle', ...pickedVehicle }
    : picked
      ? { type: 'dot', ...picked }
      : pickedCell;
  const zoomTo = (h: Hotspot) => setFocusBox({ x0: h.x0, y0: h.y0, x1: h.x1, y1: h.y1, nonce: Date.now() });

  const demoUnits = loaded
    ? (liveScene?.officers ?? makeOfficers(loaded.map, OFFICERS)).map((o) => ({
        id: o.id,
        unit: o.unit,
        post:
          loaded.map.places.find((p) => p.cells.includes('homeCell' in o ? o.homeCell : o.cell))?.name ??
          'Outdoor post',
      }))
    : [];
  const chooseRole = (choice: DemoRole) => {
    saveRole(choice);
    markSignedIn();
    setRoleChoice(choice);
    setShowRole(false);
    setFollowing(true);
  };
  const roleDialog = showRole ? (
    <DemoAccess
      choice={roleChoice}
      units={demoUnits}
      onChoose={chooseRole}
      onSkip={() => chooseRole({ role: 'supervisor', unitId: roleChoice.unitId })}
    />
  ) : null;
  // How many Kev answers the server has cached: shown on About.
  const [kevAnswers, setKevAnswers] = useState<number | null>(null);
  useEffect(() => {
    if (railTab !== 'about') return;
    fetch('/api/health')
      .then((r) => r.json())
      .then((h: { cachedDecisions?: number }) =>
        setKevAnswers(typeof h.cachedDecisions === 'number' ? h.cachedDecisions : null),
      )
      .catch(() => setKevAnswers(null));
  }, [railTab]);

  // Keyboard: 1-3 put a plan on the map, P runs or pauses, ? shows every shortcut.
  // Space (talk) and / (type) live in the command box. Ignored while typing.
  const [showKeys, setShowKeys] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || t?.closest?.('input, textarea, select, [contenteditable]')) return;
      if (e.key === '?') {
        e.preventDefault();
        setShowKeys((v) => !v);
      } else if (e.key === 'Escape') {
        setShowKeys(false);
      } else if (loaded && ['1', '2', '3'].includes(e.key)) {
        setCloseRun(Number(e.key) - 1);
        if (view === 'compare') setView('close');
      } else if (loaded && (e.key === 'p' || e.key === 'P') && !allDone) {
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loaded, allDone, view]);
  const keysCard = showKeys && (
    <div className="keys-card" role="dialog" aria-label="Keyboard shortcuts" onClick={() => setShowKeys(false)}>
      <div onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        <dl>
          <dt>
            <kbd>Space</kbd> (hold)
          </dt>
          <dd>Talk: say an order, a question or a control</dd>
          <dt>
            <kbd>/</kbd>
          </dt>
          <dd>Type an order</dd>
          <dt>
            <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd>
          </dt>
          <dd>Put plan A, B or C on the map</dd>
          <dt>
            <kbd>P</kbd>
          </dt>
          <dd>Run or pause the plans</dd>
          <dt>
            <kbd>Esc</kbd>
          </dt>
          <dd>Cancel what you were doing, or close this</dd>
          <dt>
            <kbd>?</kbd>
          </dt>
          <dd>Show or hide these shortcuts</dd>
        </dl>
        <button onClick={() => setShowKeys(false)}>Close</button>
      </div>
    </div>
  );
  if (!mapId) {
    return (
      <>
        {roleDialog}
        <StartScreen
          onPick={(id) => {
            const url = new URL(window.location.href);
            url.searchParams.set('map', id);
            window.history.replaceState(null, '', url);
            setMapId(id);
          }}
        />
      </>
    );
  }

  return (
    <>
      {roleDialog}
      {keysCard}
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
              <button
                className="link"
                onClick={() => {
                  setPlaying(false);
                  setLoaded(null);
                  setMapId(null);
                }}
              >
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
              onClick={() => setIncidentIndex(i)}
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
                style={{ left: `${((incident.at - window_.startAt) / (window_.endAt - window_.startAt)) * 100}%` }}
                title={`${INCIDENT_LABELS[incident.kind]} ${minutes(incident.at)} from kickoff`}
              />
            )}
          </span>
        </div>
        <div className="role-switch">
          <span>{officerRole ? (own?.unit ?? policeCopy.officer) : policeCopy.supervisor}</span>
          <button onClick={() => setShowRole(true)}>{policeCopy.switchRole}</button>
        </div>
        <ThemeToggle />
      </header>

      {showSynthetic && (
        <div className="banner notice">
          <p>
            <span className="notice-tag">Synthetic data</span>Crowd, traffic and sensors are simulated. Forecasts are
            model output, not observations.
          </p>
          <button
            className="small ghost"
            onClick={() => setShowSynthetic(false)}
            aria-label="Dismiss the synthetic-data note"
          >
            Dismiss
          </button>
        </div>
      )}

      {loadError && (
        <p className="banner error">
          Could not reach the server: {loadError}. Start it with <code>npm run serve</code>.
        </p>
      )}

      <div className={`layout${officerRole ? ' officer-layout' : ''}`}>
        <main>
          <div className="controls transport">
            <button className="go play" onClick={() => setPlaying((p) => !p)} disabled={!loaded || allDone}>
              {allDone ? 'Finished' : playing ? 'Pause' : started ? 'Resume' : 'Run all three plans'}
            </button>
            <span
              className="speed"
              role="group"
              aria-label="Simulation speed"
              title="How fast the simulated clock runs"
            >
              {SPEEDS.map((s) => (
                <button key={s} className={speed === s ? 'on' : undefined} onClick={() => setSpeed(s)}>
                  {s}×
                </button>
              ))}
            </span>
            <label className="field">
              <span>Weather</span>
              <select
                value={weatherId}
                onChange={(e) => setWeatherId(e.target.value)}
                title="The same for all three plans"
              >
                {WEATHER_TIMELINES.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
              </select>
            </label>
            {/* What the sky is doing on the map now, beside the scenario that was
                picked: the two differ once an incident changes the weather. */}
            {liveSky && (
              <span className="live-sky" title="The sky in the run on the map right now">
                On the map: {liveSky}
              </span>
            )}
            <label className="toggle" title="Simulate vehicle traffic alongside the crowd">
              <input
                type="checkbox"
                checked={trafficOn}
                onChange={(e) => setTrafficOn(e.target.checked)}
                disabled={!loaded || !hasRoads(loaded.map)}
              />
              Vehicles
            </label>
            {loaded && trafficOn && (
              <span className="muted" title="Synthetic traffic. Buildings and off-map parking are not counted.">
                {policeCopy.roadCapacity(trafficCapacity(loaded.map).stalls, trafficCapacity(loaded.map).vehicles)}
              </span>
            )}
            <label className="toggle">
              <input type="checkbox" checked={showCoverage} onChange={(e) => setShowCoverage(e.target.checked)} />
              {policeCopy.coverage}
            </label>
            <button onClick={restart} disabled={!loaded}>
              Restart
            </button>
          </div>
          {loaded && !officerRole && planStates.length === 3 && (
            <CommandBar
              map={loaded.map}
              labels={LABELS}
              planOnMap={closeRun}
              officersOf={(i) => runs[i]!.scene.current?.officers ?? []}
              canOrderOn={(i) => scrub === null && started && runs[i]!.scorecard === null}
              onOrder={(i, order) => {
                // Like the Orders panel: an order goes to one plan, the one put on the map.
                if (scrub !== null || !started || runs[i]!.scorecard !== null) return;
                runs[i]!.send({ type: 'order', order });
                setCloseRun(i);
              }}
              onShowPlan={(i) => {
                setCloseRun(i);
                if (view === 'compare') setView('close');
              }}
              onAddStep={(i, step) => {
                // Appended, so the plan's switched-off step indexes stay right.
                setPlanStates((prev) =>
                  prev.map((p, j) =>
                    j === i ? { plan: { ...p.plan, actions: [...p.plan.actions, step] }, disabled: p.disabled } : p,
                  ),
                );
                setPlansDirty(true);
              }}
              onRemoveStep={(i, step) => {
                const k = planStates[i]?.plan.actions.lastIndexOf(step) ?? -1;
                if (k < 0) return false;
                // Switched-off steps after it move up one.
                setPlanStates((prev) =>
                  prev.map((p, j) =>
                    j === i
                      ? {
                          plan: { ...p.plan, actions: p.plan.actions.filter((_, x) => x !== k) },
                          disabled: new Set([...p.disabled].filter((d) => d !== k).map((d) => (d > k ? d - 1 : d))),
                        }
                      : p,
                  ),
                );
                setPlansDirty(true);
                return true;
              }}
              onUndoLive={(i) => {
                if (scrub !== null || !started || runs[i]!.scorecard !== null) return null;
                const last = lastUndoable(runs[i]!.scene.current ?? null);
                if (!last) return null;
                runs[i]!.send({ type: 'order', order: last.inverse });
                setCloseRun(i);
                return describeUndo(last.inverse, loaded.map);
              }}
              onControl={(c) => {
                const w = loaded.map.width;
                switch (c.kind) {
                  case 'play':
                    if (allDone) return 'All three plans have finished. Say “restart” to run them again.';
                    setPlaying(true);
                    return started ? 'Resuming all three plans.' : 'Running all three plans.';
                  case 'pause':
                    setPlaying(false);
                    return 'Paused.';
                  case 'speed': {
                    const at = SPEEDS.indexOf(speed as (typeof SPEEDS)[number]);
                    const next =
                      c.to === 'up'
                        ? SPEEDS[Math.min(SPEEDS.length - 1, at + 1)]!
                        : c.to === 'down'
                          ? SPEEDS[Math.max(0, at - 1)]!
                          : [...SPEEDS].sort(
                              (a, b) => Math.abs(a - (c.to as number)) - Math.abs(b - (c.to as number)),
                            )[0]!;
                    setSpeed(next);
                    return `Speed ${next} times.`;
                  }
                  case 'view':
                    setView(c.view);
                    return c.view === 'close'
                      ? 'Showing the 3D view.'
                      : c.view === 'plan'
                        ? 'Showing the 2D plan.'
                        : 'Showing all three plans side by side.';
                  case 'tab':
                    setRailTab(c.tab);
                    return `Opened the ${RAIL_TABS.find((x) => x.id === c.tab)!.label} tab.`;
                  case 'restart':
                    restart();
                    return 'Restarting all three plans.';
                  case 'whole_map':
                    setFocusBox({ x0: 0, y0: 0, x1: w - 1, y1: loaded.map.height - 1, nonce: Date.now() });
                    return 'Showing the whole map.';
                  case 'zoom': {
                    const cells =
                      (c.street ? loaded.map.closables : loaded.map.places).find((x) => x.id === c.place.id)?.cells ??
                      [];
                    if (cells.length === 0) return `I can't find ${c.place.label} on the map.`;
                    const xs = cells.map((k) => k % w);
                    const ys = cells.map((k) => Math.floor(k / w));
                    // Loops, not spreads: a lot can be thousands of cells.
                    let x0 = Infinity,
                      y0 = Infinity,
                      x1 = -Infinity,
                      y1 = -Infinity;
                    for (let k = 0; k < xs.length; k++) {
                      x0 = Math.min(x0, xs[k]!);
                      x1 = Math.max(x1, xs[k]!);
                      y0 = Math.min(y0, ys[k]!);
                      y1 = Math.max(y1, ys[k]!);
                    }
                    const pad = 12;
                    setFocusBox({ x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad, nonce: Date.now() });
                    return `Showing ${c.place.label}.`;
                  }
                }
              }}
              facts={() => ({
                map: loaded.map,
                plan: LABELS[closeRun]!,
                clock: clockText(runs[closeRun]!.t),
                started,
                gates: runs[closeRun]!.scene.current?.gates ?? [],
                officers: runs[closeRun]!.scene.current?.officers ?? [],
                hotspots: police[closeRun] ?? [],
              })}
            />
          )}
          {loaded && (
            <>
              <div className={`canvas-wrap${view === 'close' ? ' close' : view === 'plan' ? ' plan' : ''}`}>
                {/* Only one of these is mounted at a time, so the page holds a
                    single WebGL context. ComparisonMaps draws all three runs in
                    one PixiJS Application for the same reason. */}
                {view !== 'close' ? (
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
                      view === 'plan'
                        ? mapPicked && mapPicked.run === closeRun
                          ? { ...mapPicked, run: 0 }
                          : null
                        : mapPicked
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
                  <button className={view === 'close' ? 'on' : undefined} onClick={() => setView('close')}>
                    3D
                  </button>
                  <button className={view === 'plan' ? 'on' : undefined} onClick={() => setView('plan')}>
                    2D plan
                  </button>
                  <button className={view === 'compare' ? 'on' : undefined} onClick={() => setView('compare')}>
                    All three
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
                      setView('close');
                      setFocusToken((k) => k + 1);
                    }}
                    onClose={() => setPicked(null)}
                  />
                )}
                {pickedVehicle && vehicleInfo && (
                  <aside className="inspector vehicle-inspector">
                    <header>
                      <div>
                        <h3>{vehicleInfo.type.label}</h3>
                        <p className="muted">
                          Vehicle {pickedVehicle.vehicle}, plan {LABELS[pickedVehicle.run]}
                        </p>
                      </div>
                      <button className="small ghost" onClick={() => setPickedVehicle(null)} title="Close">
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
                )}
                {pickedCell && placeIndex && !picked && !pickedVehicle && (
                  <aside className="inspector vehicle-inspector">
                    <header>
                      <span
                        className="swatch"
                        style={{ background: `rgb(${bands[pickedCell.band]!.rgb.join(',')})` }}
                      />
                      <div>
                        <h3>{bands[pickedCell.band]!.label}</h3>
                        <p className="muted">
                          {bands[pickedCell.band]!.range}, plan {LABELS[pickedCell.run]}
                        </p>
                      </div>
                      <button className="small ghost" onClick={() => setPickedCell(null)} title="Close">
                        ✕
                      </button>
                    </header>
                    <section>
                      <p>
                        <strong>{pickedCell.density.toFixed(2)} people/m²</strong> near{' '}
                        {placeIndex.describe(pickedCell.cell)}
                      </p>
                      <p className="muted">
                        {bands[pickedCell.band]!.note} Every area this colour is highlighted, and the list below the map
                        shows where.
                      </p>
                    </section>
                  </aside>
                )}
                {!started && !picked && (
                  <div className="map-cta">
                    <p>{incident && pitchFor(incident, zoneName)}</p>
                    <button className="primary" onClick={() => setPlaying(true)} disabled={!runs.every((r) => r.ready)}>
                      Run all three plans
                    </button>
                    <span className="muted">
                      Then scroll to zoom in and click any fan to see why they move. Or hold <kbd>Space</kbd> and say
                      “run the plans”.
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
                              {n(h.people)} people, {n(h.cells * CELL_SIZE_M * CELL_SIZE_M)} m², peak{' '}
                              {h.peak.toFixed(1)}/m²
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
          )}
        </main>

        {officerRole ? (
          <OfficerConsole
            officer={own}
            disabled={ordersDisabled}
            following={following}
            onFollow={() => setFollowing((v) => !v)}
            nearby={nearby}
            where={own && loaded ? loaded.map.places.find((p) => p.cells.includes(own.targetCell))?.name : undefined}
            onAck={() => {
              if (own) sendOrder({ type: 'officer_ack', officerId: own.id });
            }}
            onReport={(reportKind) => armPick({ kind: 'officer_report', reportKind })}
            onBackup={() => {
              if (own)
                sendOrder({
                  type: 'officer_report',
                  reportId: own.id + ':' + t + ':' + (liveScene?.orders?.length ?? 0),
                  officerId: own.id,
                  toCell: own.cell,
                  kind: 'backup',
                });
            }}
          />
        ) : (
          <aside className="side">
            <div className="rail-tabs" role="tablist" aria-label="Side panel">
              {RAIL_TABS.map((tab) => (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={railTab === tab.id}
                  className={railTab === tab.id ? 'on' : undefined}
                  onClick={() => setRailTab(tab.id)}
                >
                  {tab.label}
                  {tab.id === 'brief' && (police[closeRun]?.filter((h) => h.level === 'critical').length ?? 0) > 0 && (
                    <b className="tab-count">{police[closeRun]!.filter((h) => h.level === 'critical').length}</b>
                  )}
                  {tab.id === 'orders' && suggestionCount > 0 && (
                    <b className="tab-count info" title={`${suggestionCount} suggested responses`}>
                      {suggestionCount}
                    </b>
                  )}
                  {tab.id === 'plans' && allDone && <b className="tab-dot" title="Results are in" />}
                </button>
              ))}
            </div>

            <div className="rail-body">
              {railTab === 'brief' && (
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
                        setRailTab('plans');
                      }}
                    />
                  )}
                  <section className="block police">
                    <h2>
                      Most congested now{' '}
                      <Info>
                        Ranked by people standing packed at 3 or more per m² and by vehicles stopped or crawling. Seated
                        fans are left out: a full section is dense but safe. This ranks places to look at; where to send
                        officers stays your call.
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

              {railTab === 'plans' && (
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
                    <h2>Verdict</h2>
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
                            <summary>
                              {briefing.canned ? 'Full numbers for every plan' : "Commander's briefing"}
                            </summary>
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
                        Click a plan to show it on the map. The plans differ only in what you tell the crowd and staff
                        to do.
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

              {railTab === 'orders' && loaded && runs[closeRun] && (
                <section className="block">
                  <h2>
                    Police orders{' '}
                    <Info>
                      Give a live order to the plan on the map. It takes effect on the next simulated second; the other
                      two plans continue as written.
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
              {railTab === 'orders' && loaded && runs[closeRun] && (
                <OfficerRoster map={loaded.map} run={runs[closeRun]!} />
              )}

              {railTab === 'gates' && loaded && runs[closeRun] && (
                <section className="block">
                  <h2>
                    Gates for plan {LABELS[closeRun]}{' '}
                    <Info>
                      Every gate's door and flow for the plan on the map: people through it per minute in and out, the
                      queue waiting, and how much of what it can pass it is passing. A closed gate passes nobody and
                      turns its queue away to the next open gate.
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
              {railTab === 'gates' && loaded && runs[closeRun] && <ZoneTable map={loaded.map} run={runs[closeRun]!} />}
              {railTab === 'gates' && loaded && runs[closeRun] && <LotBoard map={loaded.map} run={runs[closeRun]!} />}

              {railTab === 'key' && (
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
                          <input
                            type="checkbox"
                            checked={showVehicles}
                            onChange={(e) => setShowVehicles(e.target.checked)}
                          />{' '}
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

              {railTab === 'about' && (
                <section className="block tech">
                  <h2>How the AI and the numbers work</h2>
                  <p>
                    {loaded ? fanCount(loaded.map).toLocaleString() : ''} fans are simulated as{' '}
                    {loaded ? (fanCount(loaded.map) / DOT_GROUP_SIZE).toLocaleString() : ''} groups of {DOT_GROUP_SIZE},
                    walking a real OpenStreetMap model of{' '}
                    {loaded ? loaded.map.name.replace(/ \+ 0\.5 mi$/, '') : 'the stadium'} at 2 m resolution. When a
                    group has to choose (shelter or run to the car? follow the officer?), an AI model called Kev gives
                    the odds of each choice for that kind of fan.
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
                        <dd>
                          {cards.map((c, i) => `${LABELS[i]} ${c ? c.peakDensity.toFixed(1) : '…'}/m²`).join(', ')}
                        </dd>
                      </>
                    )}
                    {cards.some((c) => c?.vehicleDelayMin !== undefined) && (
                      <>
                        <dt>Vehicles that drove off</dt>
                        <dd>{cards.map((c, i) => `${LABELS[i]} ${c ? n(c.vehiclesOut ?? 0) : '…'}`).join(', ')}</dd>
                        <dt>Most stopped at once</dt>
                        <dd>
                          {cards.map((c, i) => `${LABELS[i]} ${c ? n(c.peakVehiclesStopped ?? 0) : '…'}`).join(', ')}
                        </dd>
                      </>
                    )}
                    <dt>Weather</dt>
                    <dd>{weatherTimeline(weatherId).label}, the same for all three</dd>
                    <dt>Random seed</dt>
                    <dd>{SEED}, the same for all three</dd>
                  </dl>
                  <p className="muted">
                    Fan behaviour, traffic and weather are an assumption, not a forecast. The tool shows the tradeoffs
                    between plans. The commander makes the call.
                  </p>
                </section>
              )}
            </div>
          </aside>
        )}
      </div>
    </>
  );
}
