import type { MapBundle } from '../../contracts.ts';
import { trafficCapacity } from '../../engine/src/index.ts';
import { WEATHER_TIMELINES } from '../../world/src/weather.ts';
import { SPEEDS } from './app-config.ts';
import { policeCopy } from './police-copy.ts';

export function TransportBar({
  loaded,
  allDone,
  playing,
  started,
  onPlay,
  speed,
  onSpeed,
  weatherId,
  onWeather,
  liveSky,
  trafficOn,
  onTraffic,
  roads,
  showCoverage,
  onCoverage,
  onRestart,
}: {
  loaded: { map: MapBundle } | null;
  allDone: boolean;
  playing: boolean;
  started: boolean;
  onPlay: () => void;
  speed: number;
  onSpeed: (speed: number) => void;
  weatherId: string;
  onWeather: (weatherId: string) => void;
  liveSky: string | null;
  trafficOn: boolean;
  onTraffic: (on: boolean) => void;
  roads: boolean;
  showCoverage: boolean;
  onCoverage: (on: boolean) => void;
  onRestart: () => void;
}) {
  return (
    <div className="controls transport">
      <button className="go play" onClick={onPlay} disabled={!loaded || allDone}>
        {allDone ? 'Finished' : playing ? 'Pause' : started ? 'Resume' : 'Run all three plans'}
      </button>
      <span className="speed" role="group" aria-label="Simulation speed" title="How fast the simulated clock runs">
        {SPEEDS.map((s) => (
          <button key={s} className={speed === s ? 'on' : undefined} onClick={() => onSpeed(s)}>
            {s}×
          </button>
        ))}
      </span>
      <label className="field">
        <span>Weather</span>
        <select
          value={weatherId}
          onChange={(e) => onWeather(e.target.value)}
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
          onChange={(e) => onTraffic(e.target.checked)}
          disabled={!loaded || !roads}
        />
        Vehicles
      </label>
      {loaded && trafficOn && (
        <span className="muted" title="Synthetic traffic. Buildings and off-map parking are not counted.">
          {policeCopy.roadCapacity(trafficCapacity(loaded.map).stalls, trafficCapacity(loaded.map).vehicles)}
        </span>
      )}
      <label className="toggle">
        <input type="checkbox" checked={showCoverage} onChange={(e) => onCoverage(e.target.checked)} />
        {policeCopy.coverage}
      </label>
      <button onClick={onRestart} disabled={!loaded}>
        Restart
      </button>
    </div>
  );
}
