import { useEffect, useState } from 'react';
import type { MapBundle } from '../../contracts.ts';

export function useShortcuts({
  loaded,
  allDone,
  view,
  setCloseRun,
  setView,
  setPlaying,
}: {
  loaded: { map: MapBundle } | null;
  allDone: boolean;
  view: 'ops' | 'close' | 'plan' | 'compare';
  setCloseRun: (run: number) => void;
  setView: (view: 'ops' | 'close' | 'plan' | 'compare') => void;
  setPlaying: (playing: boolean | ((playing: boolean) => boolean)) => void;
}): { showKeys: boolean; setShowKeys: (show: boolean | ((show: boolean) => boolean)) => void } {
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
        if (view === 'compare') setView('ops');
      } else if (loaded && (e.key === 'p' || e.key === 'P') && !allDone) {
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loaded, allDone, view]);
  return { showKeys, setShowKeys };
}
