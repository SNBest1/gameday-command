import { useEffect, useRef } from 'react';
import { VEHICLE_KINDS, VEHICLE_STATES, type Briefing, type IncidentKind, type MapBundle } from '../../contracts.ts';
import { LABELS } from './app-config.ts';
import type { RunHandle } from './useRun.ts';

export function useAutorun({
  autorun,
  loaded,
  runA,
  runB,
  runC,
  runs,
  setPlaying,
  incidentKind,
  weatherId,
  traffic,
  allDone,
  savedComparison,
  briefing,
}: {
  autorun: boolean;
  loaded: { map: MapBundle } | null;
  runA: RunHandle;
  runB: RunHandle;
  runC: RunHandle;
  runs: RunHandle[];
  setPlaying: (value: boolean) => void;
  incidentKind: IncidentKind | null;
  weatherId: string;
  traffic: boolean;
  allDone: boolean;
  savedComparison: string | null;
  briefing: Briefing | null;
}): void {
  // Start without a click when asked, once all three workers are ready. Only
  // once: `playing` is not a dependency, so this effect never sees a pause,
  // but without the ref the next ready flip after a restart would start play again.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autorun || autoStarted.current || !loaded) return;
    if (!runs.every((r) => r.ready)) return;
    autoStarted.current = true;
    setPlaying(true);
  }, [loaded, runA.ready, runB.ready, runC.ready]);

  // Published for an unattended run: a browser with no debugger attached can
  // still be checked, because the server sees the saved comparison.
  useEffect(() => {
    (window as unknown as { gameday?: unknown }).gameday = {
      mapId: loaded?.map.id ?? null,
      incident: incidentKind,
      weather: weatherId,
      traffic,
      allDone,
      /** Vehicles in a run doing something, for pointing the camera at them in a check. */
      vehiclesIn: (run: number, state: string) => {
        const v = runs[run]?.latest.current?.frame.vehicles;
        if (!v) return [];
        const out: { i: number; kind: string; x: number; y: number }[] = [];
        for (let i = 0; i < v.state.length; i++) {
          if (VEHICLE_STATES[v.state[i]!] === state)
            out.push({ i, kind: VEHICLE_KINDS[v.kind[i]!]!, x: v.x[i]!, y: v.y[i]! });
        }
        return out;
      },
      savedComparison,
      briefing: briefing ? { canned: briefing.canned, model: briefing.model } : null,
      runs: runs.map((r, i) => ({
        label: LABELS[i],
        ready: r.ready,
        t: r.t,
        frames: r.frameCount,
        scorecard: r.scorecard,
        snapshotAt: r.snapshotAt,
        snapshotDots: r.snapshotDots,
        fallbacksSoFar: r.fallbackCount,
      })),
    };
  });
}
