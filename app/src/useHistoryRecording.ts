import { useEffect, useMemo, useRef } from 'react';
import type { MapBundle } from '../../contracts.ts';
import { stoppedPerStreet, streetIndex } from './command.ts';
import type { RunHandle } from './useRun.ts';

export function useHistoryRecording({
  loaded,
  runA,
  runB,
  runC,
  generation,
  allDone,
  loadHistory,
}: {
  loaded: { map: MapBundle } | null;
  runA: RunHandle;
  runB: RunHandle;
  runC: RunHandle;
  generation: number;
  allDone: boolean;
  loadHistory: (id: string) => void;
}): void {
  // Record this run's gate queues and stopped traffic by minute to kickoff, so
  // the next run of this stadium has a "usual" to compare against. Each run
  // only adds moments later than its last, so a rewind does not count twice.
  const recorded = useRef<{
    generation: number;
    lastT: number[];
    samples: { kind: string; subject: string; minute: number; value: number }[];
    sent: boolean;
  }>({
    generation: -1,
    lastT: [],
    samples: [],
    sent: false,
  });
  const streets = useMemo(() => (loaded ? streetIndex(loaded.map) : null), [loaded]);
  useEffect(() => {
    if (!loaded || !streets) return;
    const runs = [runA, runB, runC];
    const rec = recorded.current;
    if (rec.generation !== generation)
      recorded.current = { generation, lastT: [-Infinity, -Infinity, -Infinity], samples: [], sent: false };
    runs.forEach((run, i) => {
      const scene = run.scene.current;
      const frame = run.latest.current?.frame;
      if (!scene || !frame || scene.t <= recorded.current.lastT[i]! || scene.t % 60 !== 0) return;
      recorded.current.lastT[i] = scene.t;
      const minute = Math.round(scene.t / 60);
      for (const g of scene.gates) {
        const place = loaded.map.places[g.place];
        if (place) recorded.current.samples.push({ kind: 'gate_waiting', subject: place.id, minute, value: g.waiting });
      }
      stoppedPerStreet(loaded.map, streets, frame.vehicles).forEach((value, k) => {
        recorded.current.samples.push({ kind: 'street_stopped', subject: streets.streets[k]!.id, minute, value });
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runA.tick, runB.tick, runC.tick, loaded, streets, generation]);
  useEffect(() => {
    const rec = recorded.current;
    if (!allDone || !loaded || rec.sent || rec.samples.length === 0) return;
    rec.sent = true;
    void fetch('/api/history', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mapId: loaded.map.id, runId: `gen-${generation}-${Date.now()}`, samples: rec.samples }),
    }).then(() => loadHistory(loaded.map.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone, loaded, generation]);
}
