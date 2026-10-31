import type { MapBundle } from '../../contracts.ts';
import type { CommandBarProps } from './CommandBar.tsx';
import type { FocusBox } from './ComparisonMaps.tsx';
import type { PoliceHotspot } from './congestion.ts';
import type { PlanState } from './PlanCards.tsx';
import type { RunHandle } from './useRun.ts';
import { lastUndoable } from './after-action.ts';
import { LABELS, SPEEDS } from './app-config.ts';
import { clockText } from './story.ts';
import { describeUndo } from './voice-answers.ts';
import type { RailTabId } from './voice-intents.ts';

export function useCommandBarProps({
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
  railTabs,
  setCloseRun,
  setView,
  setPlanStates,
  setPlansDirty,
  setPlaying,
  setSpeed,
  setRailTab,
  restart,
  setFocusBox,
}: {
  loaded: { map: MapBundle } | null;
  planStates: PlanState[];
  closeRun: number;
  runs: RunHandle[];
  scrub: number | null;
  started: boolean;
  view: 'ops' | 'close' | 'plan' | 'compare';
  allDone: boolean;
  speed: number;
  police: PoliceHotspot[][];
  railTabs: readonly { id: RailTabId; label: string }[];
  setCloseRun: (run: number) => void;
  setView: (view: 'ops' | 'close' | 'plan' | 'compare') => void;
  setPlanStates: (updater: (prev: PlanState[]) => PlanState[]) => void;
  setPlansDirty: (dirty: boolean) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  setRailTab: (tab: RailTabId) => void;
  restart: () => void;
  setFocusBox: (box: FocusBox) => void;
}): CommandBarProps | null {
  if (!loaded) return null;
  return {
    map: loaded.map,
    labels: LABELS,
    planOnMap: closeRun,
    officersOf: (i) => runs[i]!.scene.current?.officers ?? [],
    canOrderOn: (i) => scrub === null && started && runs[i]!.scorecard === null,
    onOrder: (i, order) => {
      // Like the Orders panel: an order goes to one plan, the one put on the map.
      if (scrub !== null || !started || runs[i]!.scorecard !== null) return;
      runs[i]!.send({ type: 'order', order });
      setCloseRun(i);
    },
    onShowPlan: (i) => {
      setCloseRun(i);
      if (view === 'compare') setView('close');
    },
    onAddStep: (i, step) => {
      // Appended, so the plan's switched-off step indexes stay right.
      setPlanStates((prev) =>
        prev.map((p, j) =>
          j === i ? { plan: { ...p.plan, actions: [...p.plan.actions, step] }, disabled: p.disabled } : p,
        ),
      );
      setPlansDirty(true);
    },
    onRemoveStep: (i, step) => {
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
    },
    onUndoLive: (i) => {
      if (scrub !== null || !started || runs[i]!.scorecard !== null) return null;
      const last = lastUndoable(runs[i]!.scene.current ?? null);
      if (!last) return null;
      runs[i]!.send({ type: 'order', order: last.inverse });
      setCloseRun(i);
      return describeUndo(last.inverse, loaded.map);
    },
    onControl: (c) => {
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
                : [...SPEEDS].sort((a, b) => Math.abs(a - (c.to as number)) - Math.abs(b - (c.to as number)))[0]!;
          setSpeed(next);
          return `Speed ${next} times.`;
        }
        case 'view':
          setView(c.view);
          return c.view === 'close'
            ? 'Showing the close-up.'
            : c.view === 'plan'
              ? 'Showing the 2D plan.'
              : 'Showing all three plans side by side.';
        case 'tab':
          setRailTab(c.tab);
          return `Opened the ${railTabs.find((x) => x.id === c.tab)!.label} tab.`;
        case 'restart':
          restart();
          return 'Restarting all three plans.';
        case 'whole_map':
          setFocusBox({ x0: 0, y0: 0, x1: w - 1, y1: loaded.map.height - 1, nonce: Date.now() });
          return 'Showing the whole map.';
        case 'zoom': {
          const cells =
            (c.street ? loaded.map.closables : loaded.map.places).find((x) => x.id === c.place.id)?.cells ?? [];
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
    },
    facts: () => ({
      map: loaded.map,
      plan: LABELS[closeRun]!,
      clock: clockText(runs[closeRun]!.t),
      started,
      gates: runs[closeRun]!.scene.current?.gates ?? [],
      officers: runs[closeRun]!.scene.current?.officers ?? [],
      hotspots: police[closeRun] ?? [],
    }),
  };
}
