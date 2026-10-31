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
import { CELL_SIZE_M, FRAME_EVERY_S, VEHICLE_KINDS, VEHICLE_STATES } from '../../contracts.ts';
import { makePopulation } from '../../brain/src/fan-types.ts';
import { makeOfficers } from '../../world/src/officers.ts';
import { incidentsFor, windowFor } from '../../world/src/incidents.ts';
import { playbookFor } from '../../world/src/playbook.ts';
import { VEHICLE_TYPES } from '../../world/src/vehicles.ts';
import { WEATHER_LABELS, weatherTimeline } from '../../world/src/weather.ts';
import type { PoliceOrder } from '../../engine/src/index.ts';
import {
  AUTORUN,
  DANGER,
  LABELS,
  MAP_PARAM,
  minutes,
  OFFICERS,
  params,
  SEED,
  START_TRAFFIC,
  START_WEATHER,
  STADIUM_FANS,
  TEST_FANS,
} from './app-config.ts';
import { getDecisionDefaults, getMap, saveComparison } from './api.ts';
import { markSignedIn, signedInThisSession } from './session.ts';
import type { PlanState } from './PlanCards.tsx';
import type { FocusBox, MapPick } from './ComparisonMaps.tsx';
import type { EditRequest } from './Inspector.tsx';
import { applyDisabled } from './PlanEditor.tsx';
import { AppHeader } from './AppHeader.tsx';
import { TransportBar } from './TransportBar.tsx';
import { MapWorkspace } from './MapWorkspace.tsx';
import { Rail } from './Rail.tsx';
import { CommandBar } from './CommandBar.tsx';
import { StartScreen } from './StartScreen.tsx';
import { applyTheme } from './theme.ts';
import { rankByPriority, type HistorySample, type Priority } from './command.ts';
import { trafficCapacity } from '../../engine/src/index.ts';
import { responseTargets, dispatchSuggestions } from './suggestions.ts';
import { DemoAccess } from './DemoAccess.tsx';
import { OfficerConsole } from './OfficerConsole.tsx';
import { readRole, saveRole, type DemoRole } from './roles.ts';
import type { PolicePickMode } from './PolicePanel.tsx';
import { barricadeAt, fenceAt } from './barricade.ts';
import { incidentStatus, rankPlans } from './story.ts';
import { policeHotspots, standingDensity, type PoliceHotspot } from './congestion.ts';
import { bandTotals, heatBands, hotspots, makePlaceIndex, type Hotspot } from './heat.ts';
import { useRun, type RunHandle, type RunInit } from './useRun.ts';
import { useHistoryRecording } from './useHistoryRecording.ts';
import { useAutorun } from './useAutorun.ts';
import { useBriefing } from './useBriefing.ts';
import { useShortcuts } from './useShortcuts.ts';
import { useCommandBarProps } from './useCommandBarProps.ts';

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
  const { showKeys, setShowKeys } = useShortcuts({ loaded, allDone, view, setCloseRun, setView, setPlaying });
  // When all three plans finish, show the comparison once; after that the rail stays where the commander puts it.
  const wasDone = useRef(false);
  useEffect(() => {
    if (allDone && !wasDone.current) setRailTab('plans');
    wasDone.current = allDone;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone]);
  // The ranking follows the priority the commander picked.
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

  const commandBarProps = useCommandBarProps({
    loaded,
    planStates,
    closeRun,
    runs,
    scrub,
    started,
    view,
    allDone,
    speed,
    police,
    railTabs: RAIL_TABS,
    setCloseRun,
    setView,
    setPlanStates,
    setPlansDirty,
    setPlaying,
    setSpeed,
    setRailTab,
    restart,
    setFocusBox,
  });

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
      <AppHeader
        loaded={loaded}
        incidents={incidents}
        incident={incident}
        incidentIndex={incidentIndex}
        onIncident={setIncidentIndex}
        t={t}
        status={status}
        progress={progress}
        timeWindow={window_}
        fansPerDot={fansPerDot}
        liveDots={liveDots}
        liveFans={liveFans}
        officerRole={officerRole}
        own={own}
        onChangeStadium={() => {
          setPlaying(false);
          setLoaded(null);
          setMapId(null);
        }}
        onRole={() => setShowRole(true)}
      />

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
          <TransportBar
            loaded={loaded}
            allDone={allDone}
            playing={playing}
            started={started}
            onPlay={() => setPlaying((p) => !p)}
            speed={speed}
            onSpeed={setSpeed}
            weatherId={weatherId}
            onWeather={setWeatherId}
            liveSky={liveSky}
            trafficOn={trafficOn}
            onTraffic={setTrafficOn}
            roads={loaded ? hasRoads(loaded.map) : false}
            showCoverage={showCoverage}
            onCoverage={setShowCoverage}
            onRestart={restart}
          />
          {commandBarProps && !officerRole && planStates.length === 3 && <CommandBar {...commandBarProps} />}
          {loaded && (
            <MapWorkspace
              loaded={loaded}
              runs={runs}
              closeRun={closeRun}
              setCloseRun={setCloseRun}
              planStates={planStates}
              incident={incident}
              view={view}
              setView={setView}
              showCoverage={showCoverage}
              showFlow={showFlow}
              setShowFlow={setShowFlow}
              playing={playing}
              setPlaying={setPlaying}
              started={started}
              zoneName={zoneName}
              scrub={scrub}
              setScrub={setScrub}
              scrubT={scrubT}
              t={t}
              maxFrames={maxFrames}
              deciding={deciding}
              police={police}
              selectedBand={selectedBand}
              setSelectedBand={setSelectedBand}
              bands={bands}
              totals={totals}
              spots={spots}
              zoomTo={zoomTo}
              showVehicles={showVehicles}
              vehicleFocus={vehicleFocus}
              focusBox={focusBox}
              mapPicked={mapPicked}
              picked={picked}
              setPicked={setPicked}
              pickedOfficer={pickedOfficer}
              setPickedOfficer={setPickedOfficer}
              pickedVehicle={pickedVehicle}
              setPickedVehicle={setPickedVehicle}
              pickedCell={pickedCell}
              setPickedCell={setPickedCell}
              vehicleInfo={vehicleInfo}
              placeIndex={placeIndex}
              officerRole={officerRole}
              roleChoice={roleChoice}
              focusToken={focusToken}
              setFocusToken={setFocusToken}
              appliedNote={appliedNote}
              applyEdit={applyEdit}
              ordersDisabled={ordersDisabled}
              pickMode={pickMode}
              orderAt={orderAt}
              armPick={armPick}
              sendOrder={sendOrder}
              traffic={traffic}
              setBriefing={setBriefing}
              setSavedComparison={setSavedComparison}
            />
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
          <Rail
            tab={railTab}
            onTab={setRailTab}
            tabs={RAIL_TABS}
            criticalCount={police[closeRun]?.filter((h) => h.level === 'critical').length ?? 0}
            suggestionCount={suggestionCount}
            allDone={allDone}
            loaded={loaded}
            incident={incident}
            started={started}
            zoneName={zoneName}
            planStates={planStates}
            runs={runs}
            closeRun={closeRun}
            history={history}
            view={view}
            setView={setView}
            setCloseRun={setCloseRun}
            setPlanStates={setPlanStates}
            setPlansDirty={setPlansDirty}
            restart={restart}
            cards={cards}
            briefing={briefing}
            briefingBusy={briefingBusy}
            priority={priority}
            setPriority={setPriority}
            rankOf={rankOf}
            picked={picked}
            setPicked={setPicked}
            plansDirty={plansDirty}
            fanCount={fanCount}
            police={police}
            generation={generation}
            ordersDisabled={ordersDisabled}
            setFocusBox={setFocusBox}
            armPick={armPick}
            pickMode={pickMode}
            pickHint={pickHint}
            sendOrder={sendOrder}
            liveScene={liveScene}
            bands={bands}
            traffic={traffic}
            showVehicles={showVehicles}
            setShowVehicles={setShowVehicles}
            vehicleFocus={vehicleFocus}
            setVehicleFocus={setVehicleFocus}
            vehicleCounts={vehicleCounts}
            totalDecisions={totalDecisions}
            guessed={guessed}
            kev={kev}
            kevAnswers={kevAnswers}
            weatherId={weatherId}
          />
        )}
      </div>
    </>
  );
}
