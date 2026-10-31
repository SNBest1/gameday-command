/** One seed for every plan in a comparison: the whole point is the same crowd. */
export const SEED = 20251023;
export const LABELS = ['A', 'B', 'C'] as const;
export const params = new URLSearchParams(window.location.search);

/**
 * The server serves the stadium map when it has been fetched, else the test
 * map. `?map=test-3gate` forces the small one, which is handy for a quick look.
 */
/** `?map=` picks a stadium; with none (and no autorun) the app starts empty, on the stadium chooser. */
export const MAP_PARAM = params.get('map');
/** `?autorun=1` starts the three runs without a click, for an unattended demo. */
export const AUTORUN = params.get('autorun') === '1';
/** `?weather=thunderstorm` and `?traffic=0` set the scenario from the URL. */
export const START_WEATHER = params.get('weather') ?? 'clear';
export const START_TRAFFIC = params.get('traffic') !== '0';
export const STADIUM_FANS = 100_000;
export const TEST_FANS = 1200;
export const OFFICERS = 24;
export const SPEEDS = [5, 20, 60] as const;
// Per-run danger line: 3.5 p/m2, not the contract default 4. A 4 p/m2 line
// only fires at the 5 p/m2 cap in this model, so plans separated by noise.
export const DANGER = 3.5;
export const n = (value: number) => Math.round(value).toLocaleString();
export const minutes = (seconds: number) => `${seconds < 0 ? '−' : '+'}${Math.abs(Math.round(seconds / 60))} min`;
